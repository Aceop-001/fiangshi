/**
 * JSONL ledger of sealed receipts. Append-only, prev_hash chained, within one epoch.
 *
 * An epoch is one continuous ledger file. It starts when the ledger starts empty: the first run, a wiped data folder, or
 * a redeploy on hosting whose disk does not survive (Render's free tier, for example). Every receipt in the epoch
 * carries its `chain_id`, so a receipt always says which chain it belongs to, and verification can say honestly that
 * receipts from an earlier epoch are still self-consistent but can no longer be checked for continuity on this server.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { dataDir, env } from "../config.js";
import { sealReceipt, type ReceiptBody } from "../core/receipt.js";
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
    durability: env("FIANGSHI_LEDGER_DURABLE") === "1" ? "durable" : "resets on redeploy",
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
  return r;
}
