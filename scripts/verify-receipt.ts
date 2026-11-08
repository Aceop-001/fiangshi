/** Verify the ledger chain (or a single receipt file). Exit 1 on any failure. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadDotEnv } from "../src/config.js";
import { verifyChain, verifyReceipt, type VerifyResult } from "../src/core/receipt.js";
import { ledgerPath, readLedger } from "../src/ledger/store.js";

export function verifyPath(path?: string): VerifyResult & { count: number } {
  if (path && path.endsWith(".json")) {
    const r = verifyReceipt(JSON.parse(readFileSync(path, "utf8")));
    return { ...r, count: 1 };
  }
  const all = readLedger(path ?? ledgerPath());
  return { ...verifyChain(all), count: all.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv();
  const r = verifyPath(process.argv[2]);
  console.log(r.ok ? `verify OK (${r.count} receipts)` : `verify FAILED\n${r.errors.join("\n")}`);
  process.exit(r.ok ? 0 : 1);
}
