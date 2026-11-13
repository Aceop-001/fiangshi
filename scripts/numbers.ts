/**
 * The single source of Fiangshi's headline numbers (final pass E, 2026-11-11). 0 credits, committed data only.
 *   npx tsx scripts/numbers.ts            print data/numbers.json (and write it)
 *   npx tsx scripts/numbers.ts --check    fail (exit 1) if any document states a census band split, census size,
 *                                         census credit total or kinship split that disagrees with these numbers
 * Bands, census size, credit spend, cost per payee, latency and label coverage are defined HERE and nowhere else:
 * the site and the API compute them from the same census (src/census.ts); documents are checked against them.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, dataDir } from "../src/config.js";
import { CENSUS_R2_SAMPLE, CENSUS_V4_SAMPLE, legacyCensus, loadCensus, loadDemoStats } from "../src/census.js";
import { checkpointPath } from "./audit.js";
import { evaluateVows, KINSHIP_REVIEW_AT } from "../src/core/vows.js";
import { pinReferenceTime } from "../src/reference-time.js";
import { POLICY_VERSION } from "../src/core/cap.js";

const CREDIT_USD = 0.006;

export function computeNumbers() {
  const reference = pinReferenceTime();
  const c = loadCensus();
  const bal = JSON.parse(readFileSync(join(ROOT, "fixtures", "audit", "balances.json"), "utf8"));
  // the census being served: the 13 Nov refresh when its checkpoint is committed, else the 9 Nov census
  const refreshed = existsSync(checkpointPath(CENSUS_R2_SAMPLE, 90));
  const cp = JSON.parse(readFileSync(checkpointPath(refreshed ? CENSUS_R2_SAMPLE : CENSUS_V4_SAMPLE, 90), "utf8")) as { labels: { address: string; entity_name?: string | null; entity_type?: string | null }[]; labels_done: string[] };
  let kBlock = 0;
  let kReview = 0;
  let verdictable = 0;
  for (const p of c.payees) {
    const rows = evaluateVows({ signals: c.signals.get(p.payee)!, price: p.price_usd, funder_labels: c.funderLabels });
    const k = rows.find((r) => r.vow === "kinship")!;
    if (k.fired) k.band === "BLOCK" ? kBlock++ : kReview++;
    if (!rows.find((r) => r.vow === "silence")!.fired) verdictable++;
  }
  const v4Billed = bal.census.census_start - bal.census.labels_stopped;
  const censusBilled = refreshed ? bal.refresh.start - bal.refresh.after_labels : v4Billed;
  const v4 = legacyCensus();
  const v4Bands = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<"ALLOW" | "REVIEW" | "BLOCK", number>;
  for (const p of v4.payees) v4Bands[p.issued_band]++;
  const queried = new Set(cp.labels_done.map((a) => a.toLowerCase())).size;
  const anyRow = new Set(cp.labels.map((l) => l.address.toLowerCase())).size;
  const named = new Set(cp.labels.filter((l) => l.entity_name || l.entity_type).map((l) => l.address.toLowerCase())).size;
  const stats = loadDemoStats();
  return {
    chain: "eip155:8453",
    census: { payees: c.payees.length, catalog_payees: c.catalog_payees, window_days: c.window_days, census_at: c.at },
    policy_version: POLICY_VERSION,
    reference_time: reference,
    bands: c.bands,
    issued_bands: c.issued_bands,
    freshness: { stale_limit_hours: c.stale_limit_hours, payees_stale: c.payees_stale, oldest_as_of: c.oldest_as_of, newest_as_of: c.newest_as_of, allow_capped: c.issued_bands.ALLOW - c.bands.ALLOW },
    kinship: { block: kBlock, review: kReview, review_at_fanout: KINSHIP_REVIEW_AT, firing_funders: c.funders.filter((f) => f.kinship_fires).length },
    verdictable: { payees: verdictable, pct: +((100 * verdictable) / c.payees.length).toFixed(1) },
    credits: {
      census_billed: censusBilled,
      census_cost_per_payee_usd: +((censusBilled * CREDIT_USD) / c.payees.length).toFixed(5),
      final_pass_billed: bal.final_pass.start - bal.final_pass.after_cold_live,
      balance_after_final_pass: bal.final_pass.after_cold_live,
      credit_usd: CREDIT_USD,
    },
    latency: { warm_p50_ms: stats?.warm_p50_ms ?? null, warm_measured_at: stats?.measured_at ?? null, cold_live_ms: bal.cold_live.ms, cold_repeat_ms: bal.cold_live.repeat_ms },
    labels: { queried, any_row: anyRow, named },
    census_v4: { payees: v4.payees.length, census_at: v4.at, policy_version: "2026-11-09.4", issued_bands: v4Bands, billed: v4Billed },
    prices_usd: { cached: 0.05, cold: 0.15, payee: 0.02 },
  };
}
export type Numbers = ReturnType<typeof computeNumbers>;

/** Every band split or headline figure stated in a document, compared with the numbers. */
export function checkDocs(n: Numbers): string[] {
  const files = [join(ROOT, "README.md"), ...readdirSync(join(ROOT, "artifacts")).filter((f) => f.endsWith(".md")).map((f) => join(ROOT, "artifacts", f)), ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => join(ROOT, "docs", f))];
  const bad: string[] = [];
  const want = `${n.bands.ALLOW}/${n.bands.REVIEW}/${n.bands.BLOCK}`;
  const triple = /(\d{1,3}(?:,\d{3})?)(?:\s*ALLOW)?\s*[·/|]\s*(\d{1,3}(?:,\d{3})?)(?:\s*REVIEW)?\s*[·/|]\s*(\d{1,3}(?:,\d{3})?)(?:\s*BLOCK)?/g;
  const int = (x: string) => Number(x.replace(/,/g, ""));
  for (const f of files) {
    const name = f.slice(ROOT.length + 1).replace(/\\/g, "/");
    readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
      // the sensitivity table's simulated policies A and C are not census claims
      if ((name === "artifacts/sensitivity.md" || name === "artifacts/refresh.md") && /^\| (A|C) \|/.test(line)) return;
      // refresh.md's projection of the bands once every record is past the freshness window is not today's census
      if (name === "artifacts/refresh.md" && line.includes("served once the newest record is past")) return;
      for (const m of line.matchAll(triple)) {
        const [a, b, c] = [int(m[1]!), int(m[2]!), int(m[3]!)];
        if (a + b + c === n.census.payees && `${a}/${b}/${c}` !== want) bad.push(`${name}:${i + 1}: band split ${a}/${b}/${c}, numbers.json says ${want}`);
      }
      // a 9 Nov figure is allowed only where the line says it is the 9 Nov census (v4)
      const historic = /9 Nov|2026-11-09|v4|policy 2026-11-09\.4|first census/.test(line) || /^- \*\*2026-11-\d\d /.test(line);
      if (historic) return;
      for (const m of line.matchAll(/(?<![\d,])(\d{3}|\d,\d{3}) of (1,923|1923) Base payees/g))
        if (int(m[1]!) !== n.census.payees) bad.push(`${name}:${i + 1}: census size ${m[1]}, numbers.json says ${n.census.payees}`);
      for (const m of line.matchAll(/Billed: \*\*(\d+) credits\*\* for ([\d,]+) payees/g))
        if (Number(m[1]) !== n.credits.census_billed) bad.push(`${name}:${i + 1}: census billed ${m[1]} credits, numbers.json says ${n.credits.census_billed}`);
      for (const m of line.matchAll(/\b(\d{2,3}) kinship BLOCKs\b/g))
        if (Number(m[1]) !== n.kinship.block) bad.push(`${name}:${i + 1}: ${m[1]} kinship BLOCKs, numbers.json says ${n.kinship.block}`);
    });
  }
  return bad;
}

if (process.argv[1]?.endsWith("numbers.ts")) {
  const n = computeNumbers();
  if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
  writeFileSync(join(dataDir(), "numbers.json"), JSON.stringify(n, null, 2) + "\n");
  if (process.argv.includes("--check")) {
    const bad = checkDocs(n);
    for (const b of bad) console.log(`MISMATCH ${b}`);
    console.log(bad.length ? `${bad.length} disagreement(s) with data/numbers.json` : `documents agree with data/numbers.json (bands ${n.bands.ALLOW}/${n.bands.REVIEW}/${n.bands.BLOCK})`);
    process.exit(bad.length ? 1 : 0);
  }
  console.log(JSON.stringify(n, null, 2));
}
