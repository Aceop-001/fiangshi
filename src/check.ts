/** check(url): probe -> snapshot lookup -> score -> model advice -> vows -> receipt -> ledger. */
import { probe } from "./adapters/probe.js";
import { adjudicate } from "./adapters/serv.js";
import { currentSettlement } from "./adapters/x402.js";
import { hashOf } from "./core/canonical.js";
import { decide, type Decision } from "./core/decide.js";
import { sanitize, components, score } from "./core/score.js";
import { evaluateVows } from "./core/vows.js";
import type { ReceiptBody } from "./core/receipt.js";
import { PayeeSignals, type Receipt, type Snapshot, type Terms } from "./core/types.js";
import { appendReceipt, ledgerPath } from "./ledger/store.js";
import { sealReceipt } from "./core/receipt.js";
import { getSnapshot } from "./snapshot.js";

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
}

/** Evaluate a payee from signals directly (used by check, lab, and tests). */
export async function evaluate(terms: Terms | null, signals: PayeeSignals, labels: Snapshot["payload"]["funder_labels"]): Promise<Decision> {
  const price = terms?.price ?? null;
  const sc = score(components(signals, labels));
  const silence = evaluateVows({ signals, price, funder_labels: labels }).find((r) => r.vow === "silence")!.fired;
  const advice = await adjudicate({ terms, signals, score: sc, silence });
  return decide(signals, price, labels, advice);
}

export async function check(url: string, opts: CheckOpts = {}): Promise<CheckResult> {
  const t0 = performance.now();
  const snap = opts.snapshot ?? (await getSnapshot());
  const pr = await probe(url);
  const terms = pr.ok ? pr.terms : null;
  const payee = terms?.payee ?? "unknown";
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
