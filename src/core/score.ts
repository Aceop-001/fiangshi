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
  const conc = nonNegNum(s.token_concentration);
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
    token_concentration: conc !== null && conc <= 1 ? conc : null,
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

export function exposure(s: PayeeSignals): number | null {
  return s.token_concentration === null ? null : 1 - s.token_concentration;
}

export function corroboration(s: PayeeSignals): number {
  const have = EVIDENCE_FIELDS.filter((f) => (s.evidence[f] ?? "").trim().length > 0).length;
  return have / EVIDENCE_FIELDS.length;
}

export function components(s: PayeeSignals, labels: Record<string, FunderLabel>): Components {
  return {
    M: maturity(s),
    P: provenance(s, labels),
    R: revenue(s),
    I: identityScore(s),
    E: exposure(s),
    C: corroboration(s),
  };
}

/** Missing components contribute 0. Result rounded to 2dp, in [0,100]. */
export function score(c: Components): number {
  let total = 0;
  for (const k of Object.keys(WEIGHTS) as ComponentKey[]) total += WEIGHTS[k] * (c[k] ?? 0);
  return round2(total);
}
