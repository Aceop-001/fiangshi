/**
 * The free answer (GET /v1/preview, the MCP tool fiangshi_preview, the CLI's `preview`): one schema for every path.
 *
 * Every response carries the same keys, whichever path produced it (null payee at probe time, census record, no record,
 * probe failed), so a client never has to guess: `vow_fired` (string or null), `vows_fired` (always an array),
 * `cost_usd` (always a number), the data's age and staleness, whether the paid check is actually available, and
 * `unknowns`: what Fiangshi could not check for this answer. Saying what is unknown is part of the answer.
 */
import { nowMs, staleHours } from "./config.js";
import { POLICY_VERSION, staleCap, type BandCap } from "./core/cap.js";
import { VOW_NAMES } from "./core/types.js";
import type { Census, CensusPayee } from "./census.js";

export const PREVIEW_KEYS = [
  "url",
  "verdict",
  "vow_fired",
  "vows_fired",
  "score",
  "reason",
  "source",
  "terms",
  "cost_usd",
  "receipt_id",
  "data_as_of",
  "data_age_hours",
  "stale",
  "paid_check",
  "paid_check_status",
  "unknowns",
  "issued_band",
  "band_cap",
  "verdict_confidence",
  "policy_version",
] as const;

export type Terms = { price_usd: number | null; network: string; asset: string; pay_to: string; terms_hash: string };
export type PreviewAnswer = {
  url: string;
  verdict: "ALLOW" | "REVIEW" | "BLOCK" | "no_record" | "no_verdict";
  vow_fired: string | null;
  vows_fired: string[];
  score: number | null;
  reason: string | null;
  source: string;
  terms: Terms | null;
  cost_usd: number;
  receipt_id: string | null;
  data_as_of: string | null;
  data_age_hours: number | null;
  stale: boolean | null;
  paid_check: string | null;
  paid_check_status: string;
  unknowns: string[];
  /** the band on the record's receipt before band caps; null when there is no record */
  issued_band: "ALLOW" | "REVIEW" | "BLOCK" | null;
  /** set when a band cap lowered the band (policy v5): currently only data_stale */
  band_cap: BandCap | null;
  verdict_confidence: "normal" | "degraded" | null;
  policy_version: string;
};

/** The most severe fired vow, by the frozen precedence order. */
export const decidingVow = (fired: readonly string[]): string | null => VOW_NAMES.find((v) => fired.includes(v)) ?? null;

/** Age of one record's data in hours (one decimal) and whether it is past the stale limit (FIANGSHI_STALE_HOURS, 72). */
export function freshness(asOf: string, now = new Date(nowMs())): { data_as_of: string; data_age_hours: number; stale: boolean } {
  const hours = Math.max(0, (now.getTime() - Date.parse(asOf)) / 3_600_000);
  return { data_as_of: asOf, data_age_hours: Math.round(hours * 10) / 10, stale: hours > staleHours() };
}

export type PaidStatus = { ok: true; url: string } | { ok: false; why: string };
const paidFields = (p: PaidStatus) =>
  p.ok
    ? { paid_check: p.url, paid_check_status: "available: x402 payment, $0.05 for a census payee, $0.15 for a cold lookup; settlement is dry-run" }
    : { paid_check: null, paid_check_status: `disabled: ${p.why}` };

/** The one staleness line. Built in one place so it can never appear twice or in two wordings. */
export const staleLine = (ageHours: number) => `anything since this payee's data was collected ${Math.round(ageHours)} hours ago: past the ${staleHours()}-hour freshness window, so the band is capped at REVIEW; re-check before paying`;

const WINDOW_UNKNOWN = (days: number) => `activity before the ${days}-day data window: wallet age is a lower bound`;

/** What the census answer could not establish for this payee. */
export function censusUnknowns(c: Census, p: CensusPayee, stale: boolean, ageHours: number): string[] {
  const out: string[] = [];
  const funder = p.first_funder ? c.funders.find((f) => f.funder === p.first_funder) : undefined;
  if (funder?.status === "shared unnamed funder") out.push(`who the first funder ${p.first_funder} is: it funded ${funder.payees} catalog sellers and Surf has no label for it, so an exchange cannot be ruled out`);
  const claimed = Boolean(p.identity?.claims_org || p.identity?.claims_product);
  if (!claimed) out.push("who operates the wallet: the seller makes no identity claim");
  else if (p.identity?.corroborated !== true) out.push("whether the seller's claimed name is true: no independent source confirms it (treated as no claim)");
  if (stale) out.push(staleLine(ageHours));
  out.push(WINDOW_UNKNOWN(c.window_days));
  return out;
}

export function nullPayeeAnswer(url: string, terms: Terms, reason: string, receiptId: string, now = new Date()): PreviewAnswer {
  return {
    url,
    verdict: "BLOCK",
    vow_fired: "null_payee",
    vows_fired: ["null_payee"],
    score: null,
    reason,
    source: "null_payee rule at probe time: no data or model call",
    terms,
    cost_usd: 0,
    receipt_id: receiptId,
    ...freshness(now.toISOString(), now),
    paid_check: null,
    paid_check_status: "not needed: a dead-end payment address is blocked for free",
    unknowns: [],
    issued_band: "BLOCK",
    band_cap: null,
    verdict_confidence: "normal",
    policy_version: POLICY_VERSION,
  };
}

export function censusAnswer(url: string, terms: Terms, c: Census, p: CensusPayee, paid: PaidStatus, now = new Date(nowMs())): PreviewAnswer {
  const f = freshness(p.as_of, now);
  const cap = staleCap(p.issued_band, f.data_age_hours, staleHours());
  const band = cap.band;
  const vow = decidingVow(p.vows);
  return {
    url,
    verdict: band,
    vow_fired: vow,
    vows_fired: [...p.vows],
    score: p.score,
    reason: vow ? `rule ${vow} fired on the census record` : band !== p.issued_band ? `no rule fired; score ${p.score}; capped at REVIEW because the data is ${Math.round(f.data_age_hours)} hours old` : `no rule fired; score ${p.score}`,
    source: `census of ${c.payees.length} payees, ${c.window_days}-day window, taken ${c.at}`,
    terms,
    cost_usd: 0,
    receipt_id: p.receipt_id,
    ...f,
    ...paidFields(paid),
    unknowns: censusUnknowns(c, p, f.stale, f.data_age_hours),
    issued_band: p.issued_band,
    band_cap: cap.band_cap,
    verdict_confidence: cap.verdict_confidence,
    policy_version: POLICY_VERSION,
  };
}

export function noRecordAnswer(url: string, terms: Terms, c: Census, paid: PaidStatus): PreviewAnswer {
  return {
    url,
    verdict: "no_record",
    vow_fired: null,
    vows_fired: [],
    score: null,
    reason: "Fiangshi holds no on-chain signals for this payee yet. The paid check fetches them (cold check). Never treat no_record as ALLOW.",
    source: "payee not in the census",
    terms,
    cost_usd: 0,
    receipt_id: null,
    data_as_of: null,
    data_age_hours: null,
    stale: null,
    ...paidFields(paid),
    unknowns: [`everything about this wallet: it is not among the ${c.payees.length} census payees`],
    issued_band: null,
    band_cap: null,
    verdict_confidence: null,
    policy_version: POLICY_VERSION,
  };
}

export function noVerdictAnswer(url: string, error: string, paid: PaidStatus): PreviewAnswer {
  return {
    url,
    verdict: "no_verdict",
    vow_fired: null,
    vows_fired: [],
    score: null,
    reason: `probe failed: ${error}`,
    source: "unpaid probe of the endpoint",
    terms: null,
    cost_usd: 0,
    receipt_id: null,
    data_as_of: null,
    data_age_hours: null,
    stale: null,
    ...paidFields(paid),
    unknowns: ["who would be paid: the endpoint did not return usable x402 payment terms"],
    issued_band: null,
    band_cap: null,
    verdict_confidence: null,
    policy_version: POLICY_VERSION,
  };
}
