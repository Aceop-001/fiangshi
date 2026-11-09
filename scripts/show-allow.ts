/** Print the census ALLOW set and one payee's breakdown (0 credits). Usage: npx tsx scripts/show-allow.ts [payee-prefix] */
import { readFileSync } from "node:fs";
import { scoredSet, setWindowDays, type Sample } from "./audit.js";

setWindowDays(90);
const s = JSON.parse(readFileSync("fixtures/audit/sample-census.json", "utf8")) as Sample;
const cp = JSON.parse(readFileSync("fixtures/audit/checkpoint-sample-census-w90.json", "utf8"));
const at = (cp.calls as { label: string; at: string }[]).filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop()!;
const { scored } = scoredSet(s, cp, at);
const url = (p: string) => s.payees.find((x) => x.payee === p)?.example_url.replace(/^https?:\/\//, "").slice(0, 40) ?? "";
const prefix = process.argv[2];
if (prefix) {
  const y = scored.find((e) => e.s.payee.startsWith(prefix));
  console.log(y ? `${y.s.payee} ${url(y.s.payee)} score ${y.r.score} ${y.r.band} fired ${y.r.fired.join(",") || "none"} identity ${JSON.stringify(y.s.identity)}` : "not found");
}
const allow = scored.filter((e) => e.r.band === "ALLOW").sort((a, b) => b.r.score - a.r.score);
console.log(`ALLOW (${allow.length}):`);
for (const e of allow) console.log(`  ${e.s.payee} ${url(e.s.payee).padEnd(40)} ${e.r.score} claim=${e.s.identity.claims_org ?? "-"} sources=${(e.s.identity.sources ?? []).join("+") || "-"}`);
