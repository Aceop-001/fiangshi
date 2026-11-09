/** List census candidates for each lab archetype (0 credits). Usage: npx tsx scripts/lab-candidates.ts */
import { readFileSync } from "node:fs";
import { scoredSet, setWindowDays, type Sample } from "./audit.js";

setWindowDays(90);
const s = JSON.parse(readFileSync("fixtures/audit/sample-census.json", "utf8")) as Sample;
const cp = JSON.parse(readFileSync("fixtures/audit/checkpoint-sample-census-w90.json", "utf8"));
const at = (cp.calls as { label: string; at: string }[]).filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop()!;
const { scored } = scoredSet(s, cp, at);
const probes = new Map(
  readFileSync("fixtures/audit/probes.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { payee: string; parsed: boolean; status: number | null }).map((p) => [p.payee, p]),
);
const sp = (p: string) => s.payees.find((x) => x.payee === p)!;
const line = (e: (typeof scored)[number]) => {
  const pr = probes.get(e.s.payee);
  return `${e.s.payee} ${sp(e.s.payee).example_url.slice(0, 60)} price=${sp(e.s.payee).price_usd} score=${e.r.score} band=${e.r.band} fired=${e.r.fired.join(",") || "-"} age_h=${e.s.wallet_age_hours?.toFixed(0)} dorm_d=${e.s.dormancy_days?.toFixed(1)} payers=${e.s.distinct_payers} claim=${e.s.identity.claims_org ?? "-"} src=${(e.s.identity.sources ?? []).join("+") || "-"} probe=${pr ? (pr.parsed ? "402ok" : String(pr.status)) : "not-probed"}`;
};
const show = (name: string, xs: typeof scored) => console.log(`\n== ${name} (${xs.length})\n` + xs.slice(0, 4).map(line).join("\n"));
const parsedFirst = (a: (typeof scored)[number], b: (typeof scored)[number]) => Number(probes.get(b.s.payee)?.parsed ?? false) - Number(probes.get(a.s.payee)?.parsed ?? false);
show("B2 sybil: kinship fired", scored.filter((e) => e.r.fired.includes("kinship")).sort(parsedFirst));
show("B3 sleeper: established (>=90d) + dormant >=60d", scored.filter((e) => (e.s.wallet_age_hours ?? 0) >= 90 * 24 - 24 && (e.s.dormancy_days ?? 0) >= 60).sort(parsedFirst));
show("B3 alt: 0 payers + price > $0.50 (history vow)", scored.filter((e) => e.r.fired.includes("history")).sort(parsedFirst));
show("B4 anon claimant: self-claim, no sources", scored.filter((e) => e.s.identity.claims_org && !(e.s.identity.sources ?? []).length).sort(parsedFirst));
show("B4 alt: identity vow fired", scored.filter((e) => e.r.fired.includes("identity")));
show("B6 silent: silence fired", scored.filter((e) => e.r.fired.includes("silence")).sort(parsedFirst));
show("C controls: ALLOW, no vow, probe 402 ok", scored.filter((e) => e.r.band === "ALLOW" && !e.r.fired.length).sort(parsedFirst));
