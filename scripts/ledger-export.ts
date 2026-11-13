/**
 * Export the live ledger (0 credits): artifacts/ledger-<date>.jsonl, never overwriting an earlier export.
 *   npx tsx scripts/ledger-export.ts [--from <ledger.jsonl>] [--out <file>]
 * Keep the export anywhere that survives; `scripts/ledger-import.ts` restores it.
 */
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { writeNoClobber } from "../src/fsutil.js";
import { ledgerPath, readLedger } from "../src/ledger/store.js";

export function exportLedger(from = ledgerPath(), out = join(ROOT, "artifacts", `ledger-${new Date().toISOString().slice(0, 10)}.jsonl`)): { path: string; entries: number } {
  const lines = readLedger(from).map((r) => JSON.stringify(r));
  const path = writeNoClobber(out, lines.length ? lines.join("\n") + "\n" : "");
  return { path, entries: lines.length };
}

if (process.argv[1]?.endsWith("ledger-export.ts")) {
  const flag = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  const r = exportLedger(flag("--from") ?? ledgerPath(), flag("--out"));
  console.log(`exported ${r.entries} entries -> ${r.path}`);
}
