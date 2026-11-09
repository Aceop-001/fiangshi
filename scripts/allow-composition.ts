/**
 * ALLOW composition audit (0 credits, committed fixtures only).
 * Census receipts carry enrichment "skipped" (no model calls), so the census is partitioned by what identity
 * examination found: no claim | claim with 0 / 1 / 2+ corroborating sources | contradicted. The live lab (real Dolphin)
 * is partitioned by its enrichment status (complete | incomplete | skipped).
 * Usage: npx tsx scripts/allow-composition.ts [--json]
 */
import { loadCensus } from "../src/census.js";
import { identityScore } from "../src/core/score.js";
import { latestLab } from "../src/site.js";

const c = loadCensus();
const state = (id: (typeof c.payees)[number]["identity"]) => {
  const claim = id.claims_org ?? id.claims_product;
  if (!claim) return "no claim";
  if (id.contradicted) return "contradicted";
  const n = new Set(id.sources ?? []).size;
  return n === 0 ? "claim, 0 sources" : n === 1 ? "claim, 1 source" : "claim, 2+ sources";
};
const STATES = ["no claim", "claim, 0 sources", "claim, 1 source", "claim, 2+ sources", "contradicted"];
const table: Record<string, { n: number; ALLOW: number; REVIEW: number; BLOCK: number; I: Record<string, number> }> = {};
for (const s of STATES) table[s] = { n: 0, ALLOW: 0, REVIEW: 0, BLOCK: 0, I: {} };
for (const p of c.payees) {
  const t = table[state(p.identity)]!;
  t.n++;
  t[p.band]++;
  if (p.band === "ALLOW") {
    const i = identityScore(c.signals.get(p.payee)!);
    const k = i === null ? "excluded" : i.toFixed(2);
    t.I[k] = (t.I[k] ?? 0) + 1;
  }
}
const lab = latestLab();
const labAllow = (lab?.results ?? []).filter((r) => r.actual.band === "ALLOW").map((r) => ({ id: r.id, enrichment: r.actual.enrichment?.status ?? "n/a", sources: r.actual.identity?.sources ?? [] }));

if (process.argv.includes("--json")) console.log(JSON.stringify({ bands: c.bands, table, lab: { file: lab?.file, allow: labAllow } }, null, 2));
else {
  console.log(`census bands: ${JSON.stringify(c.bands)} (all 800 census receipts: enrichment "skipped", no model calls)\n`);
  console.log("| identity examination | payees | ALLOW | REVIEW | BLOCK | I among ALLOWs |\n|---|---|---|---|---|---|");
  for (const s of STATES) {
    const t = table[s]!;
    console.log(`| ${s} | ${t.n} | ${t.ALLOW} | ${t.REVIEW} | ${t.BLOCK} | ${Object.entries(t.I).map(([k, v]) => `${k}: ${v}`).join(", ") || "-"} |`);
  }
  console.log(`\nlive lab (${lab?.file}): ALLOWs by enrichment: ${labAllow.map((a) => `${a.id} ${a.enrichment} [${a.sources.join("+")}]`).join("; ")}`);
}
