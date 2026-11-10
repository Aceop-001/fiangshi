/** check(url): probe -> snapshot lookup -> score -> model advice -> vows -> receipt -> ledger. */
import { probe, type ProbeResult } from "./adapters/probe.js";
import { adjudicate } from "./adapters/serv.js";
import { extractIdentity, liveTransport, type ExtractResult } from "./adapters/dolphin.js";
import { join } from "node:path";
import { replayDir, replayMode } from "./config.js";

/** Fixture mode: a listing with no recorded Dolphin reply is a provider failure (enrichment incomplete), never a network call. */
const replayTransport = async (): Promise<unknown> => {
  throw new Error("replay: no recorded Dolphin response for this listing");
};
import { currentSettlement } from "./adapters/x402.js";
import { hashOf } from "./core/canonical.js";
import { decide, type Decision } from "./core/decide.js";
import { sanitize, components, score } from "./core/score.js";
import { evaluateVows } from "./core/vows.js";
import type { ReceiptBody } from "./core/receipt.js";
import { PayeeSignals, minBand, type Receipt, type Snapshot, type Terms } from "./core/types.js";
import { appendReceipt, ledgerPath } from "./ledger/store.js";
import { sealReceipt } from "./core/receipt.js";
import { getSnapshot } from "./snapshot.js";
import { v6 } from "./core/v6.js";
import { contradicts, corroborate } from "./core/identity.js";

export function emptySignals(payee: string): PayeeSignals {
  return {
    payee,
    wallet_age_hours: null,
    tx_count: null,
    first_funder: null,
    funder_fanout: null,
    distinct_payers: null,
    repeat_payers: null,
    total_received_usd: null,
    appears_in_other_listings: null,
    token_asset_share: null,
    top_payer_share: null,
    dormancy_days: null,
    identity: { claims_org: null, claims_product: null, corroborated: null },
    evidence: {},
  };
}

/** Any row that fails the contract becomes all-missing signals: REVIEW, never a crash, never ALLOW. */
export function coerceSignals(raw: unknown, payee: string): PayeeSignals {
  const p = PayeeSignals.safeParse(raw);
  return p.success ? sanitize(p.data) : emptySignals(payee.toLowerCase());
}

export interface CheckResult {
  url: string;
  terms: Terms | null;
  probe_error: string | null;
  signals: PayeeSignals;
  decision: Decision;
  receipt: Receipt;
  snapshot_id: string;
  ms: number;
}

export interface CheckOpts {
  snapshot?: Snapshot;
  ledger?: string | false; // false = don't persist
  now?: Date;
  /** A probe the caller already made for this URL: reused instead of probing again, so gate and receipt see the same 402. */
  probe?: ProbeResult;
}

/** Evaluate a payee from signals directly (used by check, lab, and tests). */
export async function evaluate(terms: Terms | null, signals: PayeeSignals, labels: Snapshot["payload"]["funder_labels"]): Promise<Decision> {
  const price = terms?.price ?? null;
  const sc = score(components(signals, labels));
  const silence = evaluateVows({ signals, price, funder_labels: labels }).find((r) => r.vow === "silence")!.fired;
  const advice = await adjudicate({ terms, signals, score: sc, silence });
  return decide(signals, price, labels, advice);
}

export type Enrichment = { status: "complete" | "incomplete" | "skipped"; reason: string | null };

export interface FullEvaluation {
  decision: Decision;
  signals: PayeeSignals; // after merging Dolphin identity claims
  extraction: ExtractResult | null; // null = no seller text to extract from
  enrichment: Enrichment;
  ms: { serv: number; dolphin: number | null; total: number };
}

/**
 * Full adjudication: SERV (verdict advice) and Dolphin (identity extraction) run IN PARALLEL, each under its own
 * timeout (FIANGSHI_SERV_TIMEOUT_MS / FIANGSHI_DOLPHIN_TIMEOUT_MS). Neither can raise the band. Fail closed:
 *  - SERV fails   -> degraded REVIEW (as before); Dolphin's claims are still merged and kept as evidence.
 *  - Dolphin fails -> OPTIONAL enrichment incomplete: no band cap, no silence, identity weight renormalised away;
 *    the receipt carries enrichment:"incomplete" and the reason. SERV's citations are kept.
 * Dolphin claims only fill identity fields that are empty; they are never treated as corroborated.
 */
export async function evaluateFull(
  terms: Terms | null,
  signals: PayeeSignals,
  labels: Snapshot["payload"]["funder_labels"],
  sellerText: string | null,
  /** identity v3 corroboration context for Dolphin claims (the URL is NEVER sent to Dolphin, only used here). */
  idCtx: { url?: string | null; catalogName?: string | null; labelName?: string | null } = {},
): Promise<FullEvaluation> {
  const t0 = performance.now();
  const price = terms?.price ?? null;
  const sc = score(components(signals, labels));
  const silence = evaluateVows({ signals, price, funder_labels: labels }).find((r) => r.vow === "silence")!.fired;
  let servMs = 0;
  let dolphinMs: number | null = null;
  const [advice, extraction] = await Promise.all([
    adjudicate({ terms, signals, score: sc, silence }).finally(() => (servMs = performance.now() - t0)),
    sellerText
      ? (replayMode()
          ? extractIdentity(sellerText, replayTransport, join(replayDir(), "dolphin"))
          : extractIdentity(sellerText, liveTransport)
        ).finally(() => (dolphinMs = performance.now() - t0)) : Promise.resolve(null),
  ]);
  let merged = signals;
  if (extraction?.claims && !signals.identity.claims_org && !signals.identity.claims_product) {
    const c = extraction.claims;
    merged = {
      ...signals,
      identity: (() => {
        const sources = corroborate({ claims: [c.claims_org, c.claims_product], claimFrom: "dolphin", url: idCtx.url, catalogName: idCtx.catalogName, labelName: idCtx.labelName });
        return { claims_org: c.claims_org, claims_product: c.claims_product, corroborated: sources.length > 0, sources, contradicted: contradicts([c.claims_org, c.claims_product], idCtx.labelName) };
      })(),
      evidence: { ...signals.evidence, identity: signals.evidence.identity ?? `dolphin extract: org=${c.claims_org ?? "null"}, product=${c.claims_product ?? "null"}` },
    };
  }
  const d = decide(merged, price, labels, advice);
  // Dolphin is OPTIONAL enrichment: a failure never caps the band and never fires silence; it is stamped on the receipt.
  const enrichment: Enrichment = !extraction
    ? { status: "skipped", reason: "no seller listing text to extract identity from" }
    : extraction.claims
      ? { status: "complete", reason: null }
      : { status: "incomplete", reason: extraction.error ?? "identity extraction failed" };
  return { decision: d, signals: merged, extraction, enrichment, ms: { serv: Math.round(servMs), dolphin: dolphinMs === null ? null : Math.round(dolphinMs), total: Math.round(performance.now() - t0) } };
}

/** A V6 BLOCK decided at probe time: no score, no model, no data call. */
function v6Decision(reason: string): Decision {
  return {
    verdict: { band: "BLOCK", score: 0, vow_fired: "null_payee", citations: [{ signal: "payee", quote: reason }], degraded: false, model: "none (V6 probe-time gate)" },
    components: { M: null, P: null, R: null, I: null, E: null, C: null },
    score: 0,
    scoreBand: "BLOCK",
    modelBand: "BLOCK",
    modelRawBand: null,
    validation: null,
    attempts: 0,
    vows: [{ vow: "null_payee", fired: true, band: "BLOCK", reason, signal: "payee" }],
  };
}

export async function check(url: string, opts: CheckOpts = {}): Promise<CheckResult> {
  const t0 = performance.now();
  const pr = opts.probe ?? (await probe(url));
  const terms = pr.ok ? pr.terms : null;
  const payee = terms?.payee ?? "unknown";

  // V6 at PROBE TIME: a null/sink payTo is BLOCKed with a sealed receipt before any snapshot, Surf or model call ($0.00).
  if (pr.ok) {
    const g = v6({ payTo: pr.payTo_raw, asset: pr.terms.asset });
    if (g.band === "BLOCK") {
      const decision = v6Decision(`${g.rule}: ${g.reason}`);
      const body: ReceiptBody = {
        payee,
        url,
        terms_hash: pr.terms.terms_hash,
        price: pr.terms.price,
        band: "BLOCK",
        score: 0,
        vow_fired: "null_payee",
        evidence: decision.verdict.citations,
        model: { verdict: null, extractor: "none", degraded: false },
        snapshot_id: hashOf({ gate: "v6", rule: g.rule }),
        checked_at: (opts.now ?? new Date()).toISOString(),
        settlement: currentSettlement(),
      };
      const receipt = opts.ledger === false ? sealReceipt(body, "genesis") : appendReceipt(body, opts.ledger ?? ledgerPath());
      return { url, terms, probe_error: null, signals: emptySignals(payee), decision, receipt, snapshot_id: body.snapshot_id, ms: performance.now() - t0 };
    }
  }

  const snap = opts.snapshot ?? (await getSnapshot());
  const row = snap.payload.payees.find((p) => p.payee === payee);
  const signals = row ? coerceSignals(row, payee) : emptySignals(payee);
  const decision = await evaluate(terms, signals, snap.payload.funder_labels);
  const v = decision.verdict;
  const body: ReceiptBody = {
    payee,
    url,
    terms_hash: terms?.terms_hash ?? hashOf({ url, probe_error: pr.ok ? null : pr.error }),
    price: terms?.price ?? null,
    band: v.band,
    score: v.score,
    vow_fired: v.vow_fired ?? null,
    evidence: v.citations,
    model: { verdict: decision.modelRawBand, extractor: "fixture-identity", degraded: v.degraded },
    snapshot_id: snap.snapshot_id,
    checked_at: (opts.now ?? new Date()).toISOString(),
    settlement: currentSettlement(),
  };
  const receipt = opts.ledger === false ? sealReceipt(body, "genesis") : appendReceipt(body, opts.ledger ?? ledgerPath());
  return {
    url,
    terms,
    probe_error: pr.ok ? null : pr.error,
    signals,
    decision,
    receipt,
    snapshot_id: snap.snapshot_id,
    ms: performance.now() - t0,
  };
}
