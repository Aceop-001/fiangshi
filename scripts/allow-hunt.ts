/**
 * ALLOW hunt: the top 3 scoring payees of the audited set, re-checked through the FULL pipeline on FRESH data.
 *   fresh Surf facts (inbound + outbound for the 3, same window) + fresh labels -> live unpaid probe of their endpoint
 *   -> SERV and Dolphin in parallel (evaluateFull) -> vows -> sealed receipt appended to data/ledger.jsonl.
 * A payee "survives" only if the model said ALLOW and the final band is ALLOW (vows did not lower it).
 * The rubric is NOT tuned here. If none survive, the binding constraint is reported.
 * Usage: npx tsx scripts/allow-hunt.ts --sample fixtures/audit/sample-census.json --days 90
 * Writes fixtures/audit/allow-hunt-w<days>.json (no-clobber). Surf: 2 SQL + 1 labels call (budget-guarded).
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { checkpointPath, labelsCall, scoredSet, setWindowDays, type Sample } from "./audit.js";
import { runSync } from "./surf/payee-facts.js";
import { parse402 } from "../src/adapters/probe.js";
import { funderLabelsFromSurf, signalsFromSurf, type SurfPayeeRow, type SurfWalletLabel } from "../src/adapters/surf.js";
import { evaluateFull } from "../src/check.js";
import { hashOf } from "../src/core/canonical.js";
import { WEIGHTS, components, type ComponentKey } from "../src/core/score.js";
import { evaluateVows } from "../src/core/vows.js";
import { loadDotEnv } from "../src/config.js";
import { appendReceipt } from "../src/ledger/store.js";
import { writeNoClobber } from "../src/fsutil.js";
import { currentSettlement } from "../src/adapters/x402.js";

loadDotEnv();
process.env.MOCK_MODELS = "";
const ROOT = join(import.meta.dirname, "..");
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const samplePath = arg("--sample") ?? join(ROOT, "fixtures", "audit", "sample-census.json");
const days = Number(arg("--days") ?? 90);
setWindowDays(days);

const sample = JSON.parse(readFileSync(samplePath, "utf8")) as Sample;
const cp = JSON.parse(readFileSync(checkpointPath(samplePath, days), "utf8"));
const ranAt = (cp.calls as { label: string; at: string }[]).filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop()!;
const base = scoredSet(sample, cp, ranAt);
const top = [...base.scored].sort((a, b) => b.r.score - a.r.score).slice(0, 3);
console.log(`top 3 of ${base.scored.length} by census score:`, top.map((t) => `${t.s.payee.slice(0, 10)} ${t.r.score} ${t.r.band}`).join(" · "));

// fresh data (same window) for exactly these 3
const payees = top.map((t) => t.s.payee);
// --reuse-census: use the census rows for these payees (same window, collected minutes earlier) instead of re-querying Surf,
// e.g. when a re-query would breach the credit floor. Probes, SERV and Dolphin always run live.
const reuse = process.argv.includes("--reuse-census");
const fresh = reuse
  ? { rows: payees.map((p) => ({ ...(cp.payee_rows[p] ?? { payee: p }) })) as Record<string, unknown>[], calls: [] as { label: string; credits: number | null; ms: number }[] }
  : await runSync(payees, days, ["payee-inbound", "payee-outbound"]);
const funders = [...new Set(fresh.rows.map((r) => String(r.first_inbound_from ?? "")).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
const lab = reuse ? { data: [] as SurfWalletLabel[], credits: 0, ms: 0 } : await labelsCall([...new Set([...payees, ...funders])]);
const surfDataAt = reuse ? ranAt : new Date().toISOString();
console.log(reuse ? `surf data: census rows (collected ${ranAt}), 0 new Surf calls` : "surf data: re-queried now");
const labels: SurfWalletLabel[] = [...lab.data, ...(cp.labels as SurfWalletLabel[]).filter((l) => !lab.data.some((x) => x.address === l.address))];
const outByFunder = Object.fromEntries((cp.funder_rows as SurfPayeeRow[]).map((r) => [r.payee.toLowerCase(), r.distinct_outbound_receivers ?? 0]));
const { labels: funderLabels, tokenContracts } = funderLabelsFromSurf(labels, outByFunder);
const now = Math.floor(Date.now() / 1000);
const snapshotId = hashOf({ source: `surf-live-${days}d`, at: new Date(now * 1000).toISOString().slice(0, 16), rows: fresh.rows });

const results: Record<string, unknown>[] = [];
for (const t of top) {
  const p = t.s.payee;
  const sp = sample.payees.find((x) => x.payee === p)!;
  const t0 = performance.now();
  let terms = null;
  let probeNote = "";
  try {
    const res = await fetch(sp.example_url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* text */
    }
    const pr = parse402({ url: sp.example_url, status: res.status, headers, body });
    terms = pr.ok ? pr.terms : null;
    probeNote = pr.ok ? (pr.terms.payee === p ? "402 parsed, payee matches catalog" : `402 parsed, LIVE PAYEE DIFFERS: ${pr.terms.payee}`) : `probe: ${pr.error}`;
  } catch (e) {
    probeNote = `probe error: ${(e as Error).message}`;
  }
  const probeMs = Math.round(performance.now() - t0);
  const row = (fresh.rows.find((r) => r.payee === p) ?? { payee: p }) as unknown as SurfPayeeRow;
  const l = labels.find((x) => x.address.toLowerCase() === p);
  let s = signalsFromSurf(row, { now, windowStart: now - days * 86400, tokenContracts, identity: l?.entity_name ? { claims_org: l.entity_name, corroborated: true } : undefined });
  s = { ...s, funder_fanout: s.first_funder ? (base.signals.filter((o) => o.payee !== p && o.first_funder === s.first_funder && funderLabels[s.first_funder!] !== "cex").length) : null };
  const sellerText = [sp.service, sp.example_url].filter(Boolean).join(" — ");
  const full = await evaluateFull(terms, s, funderLabels, sellerText || null);
  const d = full.decision;
  const comps = components(full.signals, funderLabels, "v2", days * 24);
  const rows = evaluateVows({ signals: full.signals, price: terms?.price ?? null, funder_labels: funderLabels });
  const receipt = appendReceipt({
    payee: p,
    url: sp.example_url,
    terms_hash: terms?.terms_hash ?? hashOf({ url: sp.example_url, probe: probeNote }),
    price: terms?.price ?? null,
    band: d.verdict.band,
    score: d.verdict.score,
    vow_fired: d.verdict.vow_fired ?? null,
    evidence: d.verdict.citations,
    model: { verdict: d.modelRawBand, extractor: full.extraction ? (full.extraction.claims ? "dolphin" : "dolphin:failed") : "none", degraded: d.verdict.degraded },
    snapshot_id: snapshotId,
    checked_at: new Date().toISOString(),
    settlement: currentSettlement(),
  });
  const total = probeMs + full.ms.total;
  const survived = d.modelRawBand === "ALLOW" && d.verdict.band === "ALLOW";
  const r = {
    payee: p,
    url: sp.example_url,
    census_score: t.r.score,
    census_band: t.r.band,
    probe: probeNote,
    fresh_score: d.verdict.score,
    score_band: d.scoreBand,
    model_band: d.modelRawBand,
    final_band: d.verdict.band,
    vow_fired: d.verdict.vow_fired ?? null,
    vows_fired: rows.filter((x) => x.fired).map((x) => `${x.vow}: ${x.reason}`),
    degraded: d.verdict.degraded,
    survived_allow: survived,
    components: Object.fromEntries((Object.keys(WEIGHTS) as ComponentKey[]).map((k) => [k, comps[k] === null ? null : +(comps[k]! * WEIGHTS[k]).toFixed(2)])),
    dolphin: full.extraction ? { claims: full.extraction.claims, error: full.extraction.error ?? null } : null,
    latency_ms: { probe: probeMs, serv: full.ms.serv, dolphin: full.ms.dolphin, models_parallel: full.ms.total, full_check: total },
    receipt_hash: receipt.receipt_hash,
  };
  results.push(r);
  console.log(`${p.slice(0, 10)} census ${t.r.score}/${t.r.band} -> fresh ${d.verdict.score}: score ${d.scoreBand}, model ${d.modelRawBand}, final ${d.verdict.band}${d.verdict.vow_fired ? ` (vow ${d.verdict.vow_fired})` : ""}${d.verdict.degraded ? " DEGRADED" : ""} | ${probeNote} | full check ${total}ms (probe ${probeMs}, models ${full.ms.total}: serv ${full.ms.serv}, dolphin ${full.ms.dolphin})`);
}
const lat = results.map((r) => (r.latency_ms as { full_check: number }).full_check).sort((a, b) => a - b);
const p50 = lat[Math.floor(lat.length / 2)];
const survivors = results.filter((r) => r.survived_allow).length;
const out = {
  at: new Date().toISOString(),
  window_days: days,
  sample: basename(samplePath),
  ranked_from: base.scored.length,
  surf_data: reuse ? `census rows reused (collected ${surfDataAt}); no Surf re-query (credit floor)` : `re-queried at ${surfDataAt}`,
  surf_calls: fresh.calls.map((c) => ({ label: c.label, credits: c.credits, ms: c.ms })),
  labels_call: { credits: lab.credits, ms: lab.ms },
  p50_full_check_ms: p50,
  survivors,
  results,
};
const saved = writeNoClobber(join(ROOT, "fixtures", "audit", `allow-hunt-w${days}.json`), JSON.stringify(out, null, 2) + "\n");
console.log(`survived ALLOW: ${survivors}/3 · p50 full check ${p50}ms · raw -> ${basename(saved)}`);
