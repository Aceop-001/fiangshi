/** Print the parse table for fixtures/402/real (traceability for capability.md). */
import { join } from "node:path";
import { loadFixtures402, parse402 } from "../src/adapters/probe.js";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
console.log("| url | status | price (USD) | asset | payee | parsed |\n|---|---|---|---|---|---|");
for (const r of loadFixtures402(join(import.meta.dirname, "..", "fixtures", "402", "real")).map(parse402)) {
  const t = r.ok ? r.terms : null;
  console.log(`| ${r.raw?.url} | ${r.raw?.status} | ${t?.price ?? "-"} | ${t ? (t.asset === USDC ? "USDC (base)" : t.asset) : "-"} | ${t ? t.payee : "-"} | ${r.ok ? "yes" : "no: " + r.error} |`);
}
