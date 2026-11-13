/**
 * Restore a ledger from a mirror folder or an exported file (0 credits).
 *   npx tsx scripts/ledger-import.ts <mirror folder | ledger-*.jsonl> [--to <ledger.jsonl>]
 * Every entry must hash to its own id and link to the ledger's last receipt; any other entry is refused and counted.
 * Entries already in the ledger are skipped. Nothing already there is rewritten.
 */
import { importEntries, ledgerPath, readEntries } from "../src/ledger/store.js";

export function importLedger(source: string, to = ledgerPath()) {
  return importEntries(readEntries(source), to);
}

if (process.argv[1]?.endsWith("ledger-import.ts")) {
  const source = process.argv[2];
  if (!source || source.startsWith("--")) {
    console.error("usage: npx tsx scripts/ledger-import.ts <mirror folder | ledger-*.jsonl> [--to <ledger.jsonl>]");
    process.exit(2);
  }
  const to = process.argv.includes("--to") ? process.argv[process.argv.indexOf("--to") + 1]! : ledgerPath();
  const r = importLedger(source, to);
  console.log(`imported ${r.accepted}, already present ${r.present}, refused ${r.refused}${r.reasons.length ? `\n  ${r.reasons.join("\n  ")}` : ""}`);
  process.exit(r.refused ? 1 : 0);
}
