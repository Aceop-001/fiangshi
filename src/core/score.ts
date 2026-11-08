/** Pure scoring. score = 25M + 20P + 20R + 15I + 10E + 10C, each component in [0,1]. */
import { EVIDENCE_FIELDS, type FunderLabel, type PayeeSignals } from "./types.js";

export const WEIGHTS = { M: 25, P: 20, R: 20, I: 15, E: 10, C: 10 } as const;
export type ComponentKey = keyof typeof WEIGHTS;
export type Components = Record<ComponentKey, number | null>;

const AGE_CAP_H = 24 * 365; // 1 year
const TX_CAP = 1000;
const DISTINCT_CAP = 100;
const REPEAT_CAP = 50;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const logCap = (x: number, cap: number) => clamp01(Math.log1p(Math.max(0, x)) / Math.log1p(cap));
const round2 = (x: number) => Math.round(x * 100) / 100;

const nonNegNum = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;

/**
 * Data errors become "missing" (null) so they fire the silence vow (REVIEW), never a BLOCK:
 * negative/NaN numbers (incl. future creation timestamps => negative age), concentration outside [0,1],
 * a payee recorded as its own funder, empty-string funder.
 */
export function sanitize(s: PayeeSignals): PayeeSignals {
  const payee = s.payee.toLowerCase();
  let funder = s.first_funder ? s.first_funder.toLowerCase() : null;
  if (funder === payee || funder === "") funder = null;
  const conc = nonNegNum(s.token_asset_share);
  const top = nonNegNum(s.top_payer_share);
  return {
    ...s,
    payee,
    first_funder: funder,
    wallet_age_hours: nonNegNum(s.wallet_age_hours),
    tx_count: nonNegNum(s.tx_count),
    funder_fanout: nonNegNum(s.funder_fanout),
    distinct_payers: nonNegNum(s.distinct_payers),
    repeat_payers: nonNegNum(s.repeat_payers),
    total_received_usd: nonNegNum(s.total_received_usd),
    appears_in_other_listings: nonNegNum(s.appears_in_other_listings),
    token_asset_share: conc !== null && conc <= 1 ? conc : null,
    top_payer_share: top !== null && top <= 1 ? top : null,
    dormancy_days: nonNegNum(s.dormancy_days),
  };
}

export function maturity(s: PayeeSignals): number | null {
  if (s.wallet_age_hours === null || s.tx_count === null) return null;
  return 0.5 * logCap(s.wallet_age_hours, AGE_CAP_H) + 0.5 * logCap(s.tx_count, TX_CAP);
}

export function provenance(s: PayeeSignals, labels: Record<string, FunderLabel>): number | null {
  if (s.first_funder === null) return null;
  const label = labels[s.first_funder];
  if (label === "cex") return 1;
  if (label === "mixer") return 0;
  if (s.funder_fanout === null) return null;
  return s.funder_fanout >= 1 ? 0.2 : 0.6; // shared vs fresh funder
}

export function revenue(s: PayeeSignals): number | null {
  if (s.distinct_payers === null) return null;
  return 0.6 * logCap(s.distinct_payers, DISTINCT_CAP) + 0.4 * logCap(s.repeat_payers ?? 0, REPEAT_CAP);
}

export function identityScore(s: PayeeSignals): number {
  const claims = Boolean(s.identity.claims_org || s.identity.claims_product);
  if (s.identity.corroborated === true && claims) return 1;
  if (!claims) return 0.5; // anonymous: neither credit nor penalty
  return 0; // claims something we cannot corroborate
}

/** Payers counted toward E: distinct inbound senders, minus the first funder when it is a labelled exchange. */
export function exposurePayers(s: PayeeSignals, labels: Record<string, FunderLabel> = {}): number | null {
  if (s.distinct_payers === null) return null;
  const cexFunderIsSender = s.first_funder !== null && labels[s.first_funder] === "cex" && s.distinct_payers > 0;
  return s.distinct_payers - (cexFunderIsSender ? 1 : 0);
}

/**
 * E v2 — payer concentration (component in [0,1]; points = 10 × E):
 *   E = min(1, log10(payers + 1) / 2) × (1 − max(0, top_payer_share − 0.30) / 0.70)
 * Breadth saturates at 99 payers; no penalty until the top payer exceeds 30% of inbound USD.
 */
export function exposure(s: PayeeSignals, labels: Record<string, FunderLabel> = {}): number | null {
  const payers = exposurePayers(s, labels);
  if (payers === null || s.top_payer_share === null) return null;
  const breadth = Math.min(1, Math.log10(payers + 1) / 2);
  const concentration = 1 - Math.max(0, s.top_payer_share - 0.3) / 0.7;
  return clamp01(breadth * concentration);
}

/** E v1 (retired 2026-11-08): 1 − top token share. Kept only to measure the v1→v2 band change. */
export function exposureV1(s: PayeeSignals): number | null {
  return s.token_asset_share === null ? null : 1 - s.token_asset_share;
}

export function corroboration(s: PayeeSignals): number {
  const have = EVIDENCE_FIELDS.filter((f) => (s.evidence[f] ?? "").trim().length > 0).length;
  return have / EVIDENCE_FIELDS.length;
}

export function components(s: PayeeSignals, labels: Record<string, FunderLabel>, eVersion: "v1" | "v2" = "v2"): Components {
  return {
    M: maturity(s),
    P: provenance(s, labels),
    R: revenue(s),
    I: identityScore(s),
    E: eVersion === "v2" ? exposure(s, labels) : exposureV1(s),
    C: corroboration(s),
  };
}

/** Missing components contribute 0. Result rounded to 2dp, in [0,100]. */
export function score(c: Components): number {
  let total = 0;
  for (const k of Object.keys(WEIGHTS) as ComponentKey[]) total += WEIGHTS[k] * (c[k] ?? 0);
  return round2(total);
}
