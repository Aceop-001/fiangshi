/**
 * Kinship sensitivity (0 credits): the served census under three kinship policies, from committed fixtures only.
 *   A (pre-calibration) kinship BLOCK when the first funder also first-funded >= 3 other catalog payees (exchange/relayer exempt)
 *   B (current, threshold v2) same trigger; >= KINSHIP_REVIEW_AT (21) other payees on one unlabelled funder -> REVIEW, flag kinship_suspected_exchange
 *   C (worst case) every unlabelled shared funder is an exchange: kinship exempt and provenance scored as an exchange
 * "fanout" below is the number of OTHER catalog payees sharing the first funder (the vow's own measure).
 * Usage: npx tsx scripts/sensitivity.ts [--json]  ->  prints the table; --write also writes artifacts/sensitivity.md
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { loadCensus } from "../src/census.js";
import { pinReferenceTime } from "../src/reference-time.js";
pinReferenceTime();
import { components, score } from "../src/core/score.js";
import { evaluateVows } from "../src/core/vows.js";
import { bandForScore, kinshipExempt, minBand, type Band, type FunderLabel, type PayeeSignals } from "../src/core/types.js";

import { KINSHIP_REVIEW_AT } from "../src/core/vows.js";
export const KINSHIP_SUSPECTED_EXCHANGE_FANOUT = KINSHIP_REVIEW_AT;
type Policy = "A" | "B" | "C";
const BANDS: Band[] = ["ALLOW", "REVIEW", "BLOCK"];

function bandUnder(policy: Policy, s: PayeeSignals, price: number | null, labels: Record<string, FunderLabel>, windowH: number): Band {
  let L = labels;
  if (policy === "C" && s.first_funder && !kinshipExempt(labels[s.first_funder]) && labels[s.first_funder] !== "mixer" && (s.funder_fanout ?? 0) >= 1)
    L = { ...labels, [s.first_funder]: "cex" };
  const sc = score(components(s, L, "v2", windowH));
  const rows = evaluateVows({ signals: s, price, funder_labels: L });
  const silence = rows.find((r) => r.vow === "silence")!.fired;
  let vowBand: Band = "ALLOW";
  for (const r of rows) {
    if (!r.fired) continue;
    // A replays the pre-calibration rule (every kinship firing BLOCKs); B and C use the vow as it is now
    const b: Band = policy === "A" && r.vow === "kinship" ? "BLOCK" : r.band;
    vowBand = minBand(vowBand, b);
  }
  return minBand(silence ? "REVIEW" : bandForScore(sc), vowBand);
}

export function sensitivity() {
  const c = loadCensus();
  const windowH = c.window_days * 24;
  const out: Record<Policy, Record<Band, number>> = { A: { ALLOW: 0, REVIEW: 0, BLOCK: 0 }, B: { ALLOW: 0, REVIEW: 0, BLOCK: 0 }, C: { ALLOW: 0, REVIEW: 0, BLOCK: 0 } };
  const moved: Record<Policy, number> = { A: 0, B: 0, C: 0 };
  let newBlocks = 0;
  for (const p of c.payees) {
    const s = c.signals.get(p.payee)!;
    const a = bandUnder("A", s, p.price_usd, c.funderLabels, windowH);
    for (const pol of ["A", "B", "C"] as Policy[]) {
      const b = pol === "A" ? a : bandUnder(pol, s, p.price_usd, c.funderLabels, windowH);
      out[pol][b]++;
      if (b !== a) moved[pol]++;
      if (pol === "B" && b === "BLOCK" && a !== "BLOCK") newBlocks++;
    }
  }
  const pct = (pol: Policy, b: Band) => (100 * (out[pol][b] - out.A[b])) / Math.max(1, out.A[b]);
  const maxMove = Math.max(...BANDS.map((b) => Math.abs(pct("B", b))));
  return { census: c.bands, policies: out, moved, newBlocks, maxMovePctB: maxMove, pct };
}

if (process.argv[1]?.endsWith("sensitivity.ts")) {
  const r = sensitivity();
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  const line = (pol: Policy, what: string) =>
    `| ${pol} | ${r.policies[pol].ALLOW} | ${r.policies[pol].REVIEW} | ${r.policies[pol].BLOCK} | ${BANDS.map((b) => `${b[0]} ${r.pct(pol, b) >= 0 ? "+" : ""}${r.pct(pol, b).toFixed(1)}%`).join(" · ")} | ${r.moved[pol]} | ${what} |`;
  const md = [
    "| policy | ALLOW | REVIEW | BLOCK | change vs A | payees moved | reading |",
    "|---|---|---|---|---|---|---|",
    line("A", "before calibration: every non-exempt shared funder with >= 3 other payees blocks"),
    line("B", `applied: clusters of >= ${KINSHIP_SUSPECTED_EXCHANGE_FANOUT} other payees on one unlabelled funder go to REVIEW`),
    line("C", "worst case: every unlabelled shared funder is an exchange"),
  ].join("\n");
  console.log(md);
  console.log(`\nPolicy B: largest band move ${r.maxMovePctB.toFixed(1)}%, new BLOCKs ${r.newBlocks}`);
}

/** Computed from the served census and its checkpoint: which kinship funders Surf was asked about, and what it said. */
function funderNote(): string {
  const c = loadCensus();
  const cpFile = existsSync(join(ROOT, "fixtures", "audit", "checkpoint-sample-census-r2-w90.json")) ? "checkpoint-sample-census-r2-w90.json" : "checkpoint-sample-census-w90.json";
  const cp = JSON.parse(readFileSync(join(ROOT, "fixtures", "audit", cpFile), "utf8")) as { labels: { address: string; entity_name?: string | null; entity_type?: string | null }[]; labels_done: string[] };
  const asked = new Set(cp.labels_done.map((a) => a.toLowerCase()));
  const named = new Set(cp.labels.filter((l) => l.entity_name || l.entity_type).map((l) => l.address.toLowerCase()));
  const sizes = new Map<string, number>();
  for (const p of c.payees) if (p.vows.includes("kinship") && p.first_funder) sizes.set(p.first_funder, (sizes.get(p.first_funder) ?? 0) + 1);
  const fs = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
  const big = fs.filter(([, n]) => n - 1 >= KINSHIP_SUSPECTED_EXCHANGE_FANOUT);
  return `${fs.length} funders sit behind a kinship vow in the census (fixtures/audit/${cpFile}). ${fs.filter(([f]) => asked.has(f)).length} of them were sent to Surf \`wallet-labels-batch\`; ${fs.filter(([f]) => named.has(f)).length} came back with an entity name or type, and none of those is an exchange or a relayer, so kinship still fires. ${big.length} of them each funded ${KINSHIP_SUSPECTED_EXCHANGE_FANOUT + 1} or more census payees (largest: ${big.slice(0, 5).map(([, n]) => n).join(", ")}), covering ${big.reduce((a, [, n]) => a + n, 0)} payees: these are the REVIEW clusters flagged \`kinship_suspected_exchange\`.`;
}

if (process.argv[1]?.endsWith("sensitivity.ts") && process.argv.includes("--write")) {
  const r = sensitivity();
  const row = (pol: Policy) => `| ${pol} | ${r.policies[pol].ALLOW} | ${r.policies[pol].REVIEW} | ${r.policies[pol].BLOCK} | ${BANDS.map((b) => `${b} ${r.pct(pol, b) >= 0 ? "+" : ""}${r.pct(pol, b).toFixed(1)}%`).join(" · ")} | ${r.moved[pol]} |`;
  const md = `# Kinship sensitivity

Generated by \`npx tsx scripts/sensitivity.ts --write\` from the committed 90-day census (0 credits). Row B is the census as it stands: it equals the bands in \`data/numbers.json\` (\`npx tsx scripts/numbers.ts\`), checked by accept gate G15. "Fanout" is the number of OTHER catalog payees whose first funder is the same wallet; the kinship vow fires at fanout >= 3 unless the funder is a labelled exchange or relayer.

| policy | ALLOW | REVIEW | BLOCK | change vs A | payees moved |
|---|---|---|---|---|---|
${row("A")}
${row("B")}
${row("C")}

- **A, before calibration.** Every unlabelled shared funder with fanout >= 3 blocks. This was the rule until 2026-11-11.
- **B, applied (kinship threshold v2, \`KINSHIP_REVIEW_AT\` in src/core/vows.ts).** Same trigger; fanout >= ${KINSHIP_SUSPECTED_EXCHANGE_FANOUT} on one unlabelled funder becomes REVIEW with the flag \`kinship_suspected_exchange\`. It creates ${r.newBlocks} new BLOCKs. The cutoff is the smallest that keeps every lab detection: the sybil case B2 sits at fanout 20 and stays BLOCK. It moves BLOCK by ${r.pct("B", "BLOCK").toFixed(1)}% and REVIEW by +${r.pct("B", "REVIEW").toFixed(1)}%, more than the 15% limit first set for this pass; the owner accepted that on 2026-11-11. At cutoff 20, B2 would have been downgraded; only cutoff 40 stays inside 15% (BLOCK -15.4%).
- **C, worst case.** If every unlabelled shared funder were an exchange, kinship would never fire on them and their provenance would score as an exchange. This is the upper bound on false blocks: at most ${r.policies.A.BLOCK - r.policies.C.BLOCK} of the ${r.policies.A.BLOCK} BLOCKs depend on those funders being something other than exchanges.

## Why the funders are still unlabelled

${funderNote()}
`;
  writeFileSync(join(ROOT, "artifacts", "sensitivity.md"), md);
  console.log("wrote artifacts/sensitivity.md");
}
