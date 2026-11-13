/**
 * JSONL ledger of sealed receipts. Append-only, prev_hash chained, within one epoch.
 *
 * An epoch is one continuous ledger file. It starts when the ledger starts empty: the first run, a wiped data folder, or
 * a redeploy on hosting whose disk does not survive (Render's free tier, for example). Every receipt in the epoch
 * carries its `chain_id`, so a receipt always says which chain it belongs to, and verification can say honestly that
 * receipts from an earlier epoch are still self-consistent but can no longer be checked for continuity on this server.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { dataDir, env } from "../config.js";
import { sealReceipt, verifyReceipt, type ReceiptBody } from "../core/receipt.js";
import type { Receipt } from "../core/types.js";

export const ledgerPath = (dir = dataDir()) => join(dir, "ledger.jsonl");
const epochPath = (ledger: string) => join(dirname(ledger), "ledger-epoch.json");

export interface Epoch {
  chain_id: string;
  started_at: string;
  /** "durable" only when the operator says the data folder survives redeploys (FIANGSHI_LEDGER_DURABLE=1). */
  durability: "durable" | "resets on redeploy";
}

export function readLedger(path = ledgerPath()): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown);
}

export function lastHash(path = ledgerPath()): string {
  const all = readLedger(path);
  const last = all[all.length - 1] as Partial<Receipt> | undefined;
  return last?.receipt_hash ?? "genesis";
}

/** The current epoch, created with a fresh id whenever the ledger starts empty. */
export function currentEpoch(path = ledgerPath()): Epoch {
  const ep = epochPath(path);
  if (existsSync(ep) && existsSync(path)) {
    try {
      return JSON.parse(readFileSync(ep, "utf8")) as Epoch;
    } catch {
      /* unreadable: start a new epoch */
    }
  }
  const started_at = new Date().toISOString();
  const epoch: Epoch = {
    chain_id: createHash("sha256").update(`${started_at}|${randomUUID()}`).digest("hex"),
    started_at,
    durability: env("FIANGSHI_LEDGER_DURABLE") === "1" || env("FIANGSHI_LEDGER_MIRROR") ? "durable" : "resets on redeploy",
  };
  mkdirSync(dirname(ep), { recursive: true });
  writeFileSync(ep, JSON.stringify(epoch, null, 2) + "\n");
  return epoch;
}

export function appendReceipt(body: ReceiptBody, path = ledgerPath()): Receipt {
  mkdirSync(dirname(path), { recursive: true });
  const epoch = currentEpoch(path);
  const r = sealReceipt({ ...body, chain_id: epoch.chain_id }, lastHash(path));
  appendFileSync(path, JSON.stringify(r) + "\n", "utf8");
  mirrorLine(JSON.stringify(r));
  return r;
}

/* ------------------------------------------------------------------ mirror ------------------------------------------ */
/**
 * FIANGSHI_LEDGER_MIRROR (a folder, default off): every appended line is also written to <mirror>/ledger-YYYY-MM-DD.jsonl,
 * fsynced, and never rewritten. Point it at storage that survives a redeploy; on start the server restores the ledger
 * from it before serving. Without a mirror the live ledger is ephemeral, and receipts are verifiable from their payload.
 */
export const mirrorDir = (): string | null => env("FIANGSHI_LEDGER_MIRROR") || null;

function mirrorLine(line: string): void {
  const dir = mirrorDir();
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const fd = openSync(join(dir, `ledger-${new Date().toISOString().slice(0, 10)}.jsonl`), "a");
  try {
    writeSync(fd, line + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Every line in a mirror folder (or one exported .jsonl file), in order: files by name, lines as written. */
export function readEntries(source: string): unknown[] {
  if (source.endsWith(".jsonl")) return readLedger(source);
  if (!existsSync(source)) return [];
  return readdirSync(source)
    .filter((f) => /^ledger-.*\.jsonl$/.test(f))
    .sort()
    .flatMap((f) => readLedger(join(source, f)));
}

export interface ImportResult {
  accepted: number;
  /** already in the ledger: skipped, not counted as refused */
  present: number;
  refused: number;
  reasons: string[];
}

/**
 * Restore a chain from saved entries. An entry is accepted only if its own hash is intact and its prev_hash links to the
 * ledger's current last receipt; anything else is refused and counted. Nothing already in the ledger is rewritten.
 */
export function importEntries(entries: unknown[], path = ledgerPath()): ImportResult {
  mkdirSync(dirname(path), { recursive: true });
  const have = new Set((readLedger(path) as Partial<Receipt>[]).map((r) => r.receipt_hash));
  let last = lastHash(path);
  const out: ImportResult = { accepted: 0, present: 0, refused: 0, reasons: [] };
  for (const e of entries) {
    const r = e as Receipt;
    if (have.has(r?.receipt_hash)) {
      out.present++;
      continue;
    }
    const v = verifyReceipt(e);
    if (!v.ok) {
      out.refused++;
      out.reasons.push(`${String(r?.receipt_hash).slice(0, 12)}: ${v.errors.join("; ")}`);
      continue;
    }
    if (r.prev_hash !== last) {
      out.refused++;
      out.reasons.push(`${r.receipt_hash.slice(0, 12)}: prev_hash does not link to ${last === "genesis" ? "genesis" : last.slice(0, 12)}`);
      continue;
    }
    appendFileSync(path, JSON.stringify(r) + "\n", "utf8");
    have.add(r.receipt_hash);
    last = r.receipt_hash;
    out.accepted++;
  }
  // the restored chain keeps its own epoch id, so receipts appended after a restore continue the same chain
  const all = readLedger(path) as Receipt[];
  const tail = all[all.length - 1];
  if (out.accepted && tail?.chain_id)
    writeFileSync(epochPath(path), JSON.stringify({ chain_id: tail.chain_id, started_at: all[0]!.checked_at, durability: "durable" } satisfies Epoch, null, 2) + "\n");
  return out;
}

let restored: { entries: number; intact: number; refused: number } | null = null;

/** On start: load the mirror into the ledger before serving. Returns what was restored, or null without a mirror. */
export function restoreFromMirror(path = ledgerPath()): { entries: number; intact: number; refused: number } | null {
  const dir = mirrorDir();
  if (!dir) return null;
  const entries = readEntries(dir);
  const r = importEntries(entries, path);
  restored = { entries: entries.length, intact: r.accepted + r.present, refused: r.refused };
  return restored;
}

/** What /health says about the live ledger, in plain words. */
export function ledgerDurability(path = ledgerPath()): string {
  const dir = mirrorDir();
  if (!dir) return "ephemeral: receipts are verifiable from their payload, not by id";
  return `durable: ${dir}, ${readLedger(path).length} entries${restored?.refused ? ` (${restored.refused} refused on restore)` : ""}`;
}
