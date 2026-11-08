/**
 * Pure adjudication: score + validated model advice + vows -> Verdict.
 *
 * Final band = min(scoreBand, modelBand, vowBand) with these fail-closed rules:
 *  - silence fired  -> the score band is REVIEW (an incomplete score is not a reason to BLOCK).
 *  - model degraded -> model band is REVIEW.
 *  - model BLOCK    -> applied as REVIEW (BLOCK needs a machine-checkable reason: a vow or a complete score < 50).
 *  - the model can only lower; it can never raise above the score band or a vow.
 */
import { components, score, type Components } from "./score.js";
import { decidingVow, evaluateVows, type VowRow } from "./vows.js";
import {
  ModelOutput,
  bandForScore,
  minBand,
  type Band,
  type Citation,
  type FunderLabel,
  type PayeeSignals,
  type Verdict,
} from "./types.js";

export interface CitationCheck extends Citation {
  signal_exists: boolean;
  is_substring: boolean;
}

export type Validation =
  | { ok: true; output: ModelOutput; checks: CitationCheck[] }
  | { ok: false; errors: string[]; checks: CitationCheck[]; band: Band | null };

/** Validate raw model text in the documented order. Never throws. */
export function validateModelOutput(raw: string, signals: PayeeSignals): Validation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["json: does not parse"], checks: [], band: null };
  }
  const shape = ModelOutput.safeParse(parsed);
  if (!shape.success) {
    return { ok: false, errors: [`schema: ${shape.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`], checks: [], band: null };
  }
  const out = shape.data;
  const errors: string[] = [];
  const checks: CitationCheck[] = out.citations.map((c) => {
    const ev = Object.prototype.hasOwnProperty.call(signals.evidence, c.signal) ? signals.evidence[c.signal] : undefined;
    const signal_exists = ev !== undefined;
    const is_substring = signal_exists && c.quote.trim().length > 0 && ev.includes(c.quote);
    if (!signal_exists) errors.push(`citation: signal "${c.signal}" not in input`);
    else if (!is_substring) errors.push(`citation: quote for "${c.signal}" is not a substring of its evidence`);
    return { ...c, signal_exists, is_substring };
  });
  if (out.citations.length === 0) errors.push("citation: none given");
  return errors.length ? { ok: false, errors, checks, band: out.band } : { ok: true, output: out, checks };
}

export interface ModelAdvice {
  model: string; // model id or "mock:<mode>" or "none"
  validation: Validation | null; // null = model not reachable
  attempts: number;
}

export interface Decision {
  verdict: Verdict;
  components: Components;
  score: number;
  scoreBand: Band;
  modelBand: Band;
  modelRawBand: Band | null;
  validation: Validation | null;
  attempts: number;
  vows: VowRow[];
}

export function decide(
  signals: PayeeSignals,
  price: number | null,
  funder_labels: Record<string, FunderLabel>,
  advice: ModelAdvice,
): Decision {
  const comps = components(signals, funder_labels);
  const sc = score(comps);
  const rows = evaluateVows({ signals, price, funder_labels });
  const silence = rows.find((r) => r.vow === "silence")?.fired ?? true;
  const scoreBand: Band = silence ? "REVIEW" : bandForScore(sc);

  const v = advice.validation;
  const degraded = !v || !v.ok;
  const modelRawBand: Band | null = v ? (v.ok ? v.output.band : v.band) : null;
  const modelBand: Band = v && v.ok ? (v.output.band === "BLOCK" ? "REVIEW" : v.output.band) : "REVIEW";

  const dv = decidingVow(rows);
  const band = minBand(scoreBand, modelBand, dv ? dv.band : "ALLOW");

  const citations: Citation[] = [];
  if (v && v.ok) citations.push(...v.output.citations);
  for (const r of rows) {
    const q = signals.evidence[r.signal];
    if (r.fired && q && !citations.some((c) => c.signal === r.signal && c.quote === q)) citations.push({ signal: r.signal, quote: q });
  }

  const verdict: Verdict = {
    band,
    score: sc,
    ...(dv ? { vow_fired: dv.vow } : {}),
    citations,
    degraded,
    model: advice.model,
  };
  return { verdict, components: comps, score: sc, scoreBand, modelBand, modelRawBand, validation: v, attempts: advice.attempts, vows: rows };
}
