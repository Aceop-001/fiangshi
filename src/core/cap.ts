/**
 * Policy versions and band caps (2026-11-13).
 *
 * A band cap is not a vow. Vows say something about the counterparty ("this wallet was funded by a ring"); a cap says
 * something about Fiangshi's own evidence ("this record is too old to vouch for today"). A cap can only lower a band,
 * runs after the vows and the model, never touches the score, and never asserts that a counterparty is unsafe:
 * that is why the stale cap stops at REVIEW and never produces BLOCK.
 *
 * Policy versions:
 *   2026-11-09.4  rules v4: identity neutrality, operator-only labels, kinship threshold v2. No band caps.
 *                 Every receipt without a policy_version was issued under v4 (all 800 census receipts).
 *   2026-11-13.5  v5: v4 + the stale cap. Receipts state policy_version and the basis of their band.
 */
import { minBand, type Band } from "./types.js";

export const POLICY_V4 = "2026-11-09.4";
export const POLICY_VERSION = "2026-11-13.5";

export interface BandCap {
  reason: "data_stale";
  age_hours: number;
  limit_hours: number;
}

export interface CapResult {
  band: Band;
  band_cap: BandCap | null;
  verdict_confidence: "normal" | "degraded";
}

/** Hours between a record's collection time and now, one decimal, never negative. */
export function ageHours(asOf: string, nowMs: number): number {
  return Math.round((Math.max(0, nowMs - Date.parse(asOf)) / 3_600_000) * 10) / 10;
}

/**
 * The stale cap: data older than the limit can support at most REVIEW. It only ever lowers: a stale BLOCK stays BLOCK,
 * a stale REVIEW stays REVIEW. band_cap is reported only when the cap actually lowered the band.
 */
export function staleCap(band: Band, age: number, limitHours: number): CapResult {
  const stale = age > limitHours;
  const capped = minBand(band, stale ? "REVIEW" : "ALLOW");
  const lowered = capped !== band;
  return {
    band: capped,
    band_cap: lowered ? { reason: "data_stale", age_hours: age, limit_hours: limitHours } : null,
    verdict_confidence: stale ? "degraded" : "normal",
  };
}

/** What a v5 receipt records about how its band was formed; the band is the lowest of these. */
export interface BandBasis {
  score_band: Band;
  model_band: Band;
  vow_band: Band;
  cap_band: Band;
}
export const bandFromBasis = (b: BandBasis): Band => minBand(b.score_band, b.model_band, b.vow_band, b.cap_band);

/** The parts of a decision a v5 receipt needs (structural, so this file stays free of the decision module). */
export interface DecisionParts {
  scoreBand: Band;
  modelBand: Band;
  vows: { fired: boolean; band: Band }[];
}

/**
 * The policy-v5 fields for a receipt: its version, the data's collection time, the cap (if it lowered the band) and the
 * band's basis. The returned band is the one to seal. With no asOf (fixture pipeline, a live probe-time BLOCK), the
 * data is as fresh as the check itself and no cap applies.
 */
export function v5Fields(
  d: DecisionParts,
  asOf: string | null,
  nowMs: number,
  limitHours: number,
): { band: Band; fields: { policy_version: string; as_of?: string; band_cap?: BandCap; band_basis: BandBasis }; cap: CapResult } {
  const firedBands = d.vows.filter((v) => v.fired).map((v) => v.band);
  const vowBand = minBand(...firedBands);
  const uncapped = minBand(d.scoreBand, d.modelBand, vowBand);
  const cap = asOf ? staleCap(uncapped, ageHours(asOf, nowMs), limitHours) : { band: uncapped, band_cap: null, verdict_confidence: "normal" as const };
  const basis: BandBasis = { score_band: d.scoreBand, model_band: d.modelBand, vow_band: vowBand, cap_band: asOf && ageHours(asOf, nowMs) > limitHours ? "REVIEW" : "ALLOW" };
  return {
    band: cap.band,
    fields: { policy_version: POLICY_VERSION, ...(asOf ? { as_of: asOf } : {}), ...(cap.band_cap ? { band_cap: cap.band_cap } : {}), band_basis: basis },
    cap,
  };
}
