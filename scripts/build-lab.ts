/**
 * Adversarial lab: runs every case in fixtures/lab/cases.json (expected verdicts written BEFORE this runs) through
 * the real pipeline and records what actually happened. Never edits the cases file.
 *   live probe -> V6 gate -> signals (cached census row; B1 one live inbound SQL call; B3 synthetic fixture)
 *   -> SERV || Dolphin (listing text only) -> vows -> sealed receipt in data/ledger.jsonl
 * Usage: npx tsx scripts/build-lab.ts   -> fixtures/lab/results.json (no-clobber), then `npx tsx scripts/matrix.ts`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { censusIdentity, checkpointPath, scoredSet, setWindowDays, surfBalance, type Sample } from "./audit.js";
import { runSync } from "./surf/payee-facts.js";
import { loadFixtures402, parse402, probe } from "../src/adapters/probe.js";
import { modelCalls } from "../src/adapters/serv.js";
import { signalsFromSurf, type SurfPayeeRow } from "../src/adapters/surf.js";
import { check, coerceSignals, evaluateFull } from "../src/check.js";
import { hashOf } from "../src/core/canonical.js";
import { v6 } from "../src/core/v6.js";
import { currentSettlement } from "../src/adapters/x402.js";
import { appendReceipt } from "../src/ledger/store.js";
import { writeNoClobber } from "../src/fsutil.js";
import { env, loadDotEnv, num } from "../src/config.js";
import type { PayeeSignals, Terms } from "../src/core/types.js";

loadDotEnv();
Object.assign(process.env, { MOCK_MODELS: "", SNAPSHOT_SOURCE: "live", FIANGSHI_OFFLINE: "0" });
const ROOT = join(import.meta.dirname, "..");
const DAYS = 90;
setWindowDays(DAYS);

interface Case { id: string; archetype: string; payee: string; url: string | null; construction: string; expected_band: string; expected_vow: string | null; expected_cost_usd?: number; note?: string }
const argv = process.argv.slice(2);
const casesFile = argv.includes("--cases") ? argv[argv.indexOf("--cases") + 1]! : "cases.json";
const reuseB1 = argv.includes("--reuse-b1"); // reuse the v1 live query for the random burner address (0 Surf credits)
const { cases } = JSON.parse(readFileSync(join(ROOT, "fixtures", "lab", casesFile), "utf8")) as { cases: Case[] };
const samplePath = join(ROOT, "fixtures", "audit", "sample-census.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8")) as Sample;
const cp = JSON.parse(readFileSync(checkpointPath(samplePath, DAYS), "utf8"));
const ranAt = (cp.calls as { label: string; at: string }[]).filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop()!;
const census = scoredSet(sample, cp, ranAt);
const byPayee = new Map(census.scored.map((e) => [e.s.payee, e]));
const labelOf = census.labelOf;

const SERV_PRICE = { in: num("FIANGSHI_SERV_PRICE_IN_PER_M", 1.0), out: num("FIANGSHI_SERV_PRICE_OUT_PER_M", 6.0) };
const DOLPHIN_PRICE = { in: 0.01, out: 0.07 };
const modelUsd = (from: number) =>
  modelCalls.slice(from).reduce((a, c) => {
    const p = c.provider === "serv" ? SERV_PRICE : DOLPHIN_PRICE;
    return a + ((c.prompt_tokens ?? 0) * p.in + (c.completion_tokens ?? 0) * p.out) / 1e6;
  }, 0);

const results: Record<string, unknown>[] = [];
for (const c of cases) {
  const t0 = performance.now();
  const mc0 = modelCalls.length;
  let surfCredits = 0;
  let row: Record<string, unknown>;
  try {
    if (c.archetype === "void") {
      // the product path end to end: check() must gate at probe time
      const r = await check(c.url!, {});
      row = {
        band: r.decision.verdict.band,
        vows_fired: r.decision.vows.filter((v) => v.fired).map((v) => v.vow),
        score: r.decision.verdict.score,
        model_band: r.decision.modelRawBand,
        degraded: r.decision.verdict.degraded,
        probe: r.terms ? `402 parsed: $${r.terms.price} to ${r.terms.payee}` : `probe failed: ${r.probe_error}`,
        reason: r.decision.verdict.citations[0]?.quote ?? null,
        receipt_hash: r.receipt.receipt_hash,
        model_calls: modelCalls.length - mc0,
      };
    } else {
      // terms: live probe (B3 is synthetic: its endpoint only exists as a recorded fixture)
      let terms: Terms | null = null;
      let probeNote = "no endpoint (burner wallet has no 402)";
      let payToRaw: string | null = null;
      if (c.archetype === "sleeper") {
        const raw = loadFixtures402().find((r) => r.url === c.url);
        const pr = raw ? parse402(raw) : null;
        terms = pr?.ok ? pr.terms : null;
        payToRaw = pr?.ok ? pr.payTo_raw : null;
        probeNote = pr?.ok ? "recorded synthetic 402 (fixtures/402)" : "synthetic 402 missing";
      } else if (c.url) {
        const pr = await probe(c.url);
        terms = pr.ok ? pr.terms : null;
        payToRaw = pr.ok ? pr.payTo_raw : null;
        probeNote = pr.ok ? `402 parsed: $${pr.terms.price} to ${pr.terms.payee}${pr.terms.payee === c.payee ? "" : " (DIFFERS from catalog payee)"}` : `probe failed: ${pr.error}`;
      }
      const g = payToRaw ? v6({ payTo: payToRaw, asset: terms?.asset }) : { band: null, rule: null, reason: "" };
      // signals
      let s: PayeeSignals;
      if (c.archetype === "burner" && reuseB1) {
        const v1 = JSON.parse(readFileSync(join(ROOT, "fixtures", "lab", "results.json"), "utf8")) as { results: { id: string; actual: { probe?: string } }[] };
        const note = v1.results.find((r) => r.id === "B1")?.actual.probe ?? "";
        const now = Math.floor(Date.now() / 1000);
        s = signalsFromSurf({ payee: c.payee } as SurfPayeeRow, { now, windowStart: now - DAYS * 86400, tokenContracts: census.tokenContracts });
        probeNote += `; reused the v1 live inbound query (fixtures/lab/results.json: ${note.split("; ").pop()}): no transfers`;
      } else if (c.archetype === "burner") {
        const before = surfBalance();
        const q = await runSync([c.payee], DAYS, ["payee-inbound"]);
        const after = surfBalance();
        surfCredits = before !== null && after !== null ? before - after : 4;
        const r0 = (q.rows.find((r) => r.payee === c.payee) ?? { payee: c.payee }) as unknown as SurfPayeeRow;
        const now = Math.floor(Date.now() / 1000);
        s = signalsFromSurf(r0, { now, windowStart: now - DAYS * 86400, tokenContracts: census.tokenContracts });
        probeNote += `; live inbound query: ${q.rows.length} rows`;
      } else if (c.archetype === "sleeper") {
        const fx = (JSON.parse(readFileSync(join(ROOT, "fixtures", "payees.json"), "utf8")) as PayeeSignals[]).find((p) => p.payee === terms?.payee);
        s = coerceSignals(fx, terms?.payee ?? "unknown");
      } else {
        const e = byPayee.get(c.payee);
        if (!e) throw new Error(`payee not in the 90d census: ${c.payee}`);
        s = e.s;
      }
      const sp = sample.payees.find((p) => p.payee === c.payee);
      const l = labelOf.get(c.payee);
      if (sp) s = { ...s, identity: censusIdentity(sp, l) ?? { claims_org: null, claims_product: null, corroborated: null } };
      if (g.band === "BLOCK") {
        row = { band: "BLOCK", vows_fired: ["null_payee"], score: 0, model_band: null, degraded: false, probe: probeNote, reason: `${g.rule}: ${g.reason}`, receipt_hash: null, model_calls: 0 };
      } else {
        const full = await evaluateFull(terms, s, census.funderLabels, sp?.service?.trim() || null, { url: c.url, catalogName: sp?.service ?? null, labelName: l?.entity_name ?? null, labelType: l?.entity_type ?? null });
        const d = full.decision;
        const receipt = appendReceipt({
          payee: s.payee,
          url: c.url ?? `lab:${c.id}`,
          terms_hash: terms?.terms_hash ?? hashOf({ lab: c.id, payee: c.payee }),
          price: terms?.price ?? null,
          band: d.verdict.band,
          score: d.verdict.score,
          vow_fired: d.verdict.vow_fired ?? null,
          evidence: d.verdict.citations,
          model: { verdict: d.modelRawBand, extractor: full.extraction ? (full.extraction.claims ? "dolphin" : "dolphin:failed") : "none", degraded: d.verdict.degraded },
          snapshot_id: hashOf({ lab: "w90", census_at: ranAt }),
          checked_at: new Date().toISOString(),
          settlement: currentSettlement(),
          enrichment: full.enrichment,
        });
        row = {
          band: d.verdict.band,
          vows_fired: d.vows.filter((v) => v.fired).map((v) => v.vow),
          vow_reasons: d.vows.filter((v) => v.fired).map((v) => `${v.vow}: ${v.reason}`),
          score: d.verdict.score,
          score_band: d.scoreBand,
          model_band: d.modelRawBand,
          degraded: d.verdict.degraded,
          identity: full.signals.identity,
          probe: probeNote,
          dolphin: full.extraction ? { claims: full.extraction.claims, error: full.extraction.error ?? null } : null,
          enrichment: full.enrichment,
          receipt_hash: receipt.receipt_hash,
          model_calls: modelCalls.length - mc0,
        };
      }
    }
  } catch (e) {
    row = { band: "ERROR", vows_fired: [], error: (e as Error).message };
  }
  const ms = Math.round(performance.now() - t0);
  const usd = modelUsd(mc0) + surfCredits * 0.006;
  const fired = (row.vows_fired as string[]) ?? [];
  const vowOk = c.expected_vow === null ? fired.length === 0 : fired.includes(c.expected_vow);
  const pass = row.band === c.expected_band && vowOk;
  const outcome = pass ? "PASS" : "FAILURE";
  results.push({ ...c, actual: row, surf_credits: surfCredits, cost_usd: +usd.toFixed(6), ms, outcome, why: pass ? null : `${row.band !== c.expected_band ? `band ${row.band} ≠ expected ${c.expected_band}` : ""}${row.band !== c.expected_band && !vowOk ? "; " : ""}${vowOk ? "" : `intended vow ${c.expected_vow ?? "none"} ${c.expected_vow ? "did not fire" : "but"} (fired: ${fired.join(", ") || "none"})`}` });
  console.log(`${c.id} ${c.archetype.padEnd(14)} expected ${c.expected_band}/${c.expected_vow ?? "-"} -> actual ${row.band}/${fired.join(",") || "-"}  ${outcome}  ${ms}ms  $${usd.toFixed(5)}${surfCredits ? ` (${surfCredits} credits)` : ""}`);
}
const out = writeNoClobber(join(ROOT, "fixtures", "lab", "results.json"), JSON.stringify({ ran_at: new Date().toISOString(), cases_file: casesFile, serv_model: env("SERV_MODEL"), census_at: ranAt, results }, null, 2) + "\n");
console.log(`results -> ${out}`);
