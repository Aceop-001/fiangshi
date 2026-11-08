/** JSONL ledger of sealed receipts. Append-only, prev_hash chained. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "../config.js";
import { sealReceipt, type ReceiptBody } from "../core/receipt.js";
import type { Receipt } from "../core/types.js";

export const ledgerPath = (dir = dataDir()) => join(dir, "ledger.jsonl");

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

export function appendReceipt(body: ReceiptBody, path = ledgerPath()): Receipt {
  mkdirSync(dirname(path), { recursive: true });
  const r = sealReceipt(body, lastHash(path));
  appendFileSync(path, JSON.stringify(r) + "\n", "utf8");
  return r;
}
