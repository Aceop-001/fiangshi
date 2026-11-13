/** Deterministic policy band (score + vows, no model), for index, audit and the E v1->v2 diff. Pure. */
import { components, score } from "./core/score.js";
import { decidingVow, evaluateVows } from "./core/vows.js";
import { bandForScore, minBand, type Band, type FunderLabel, type PayeeSignals, type VowName } from "./core/types.js";

export interface PolicyResult {
  band: Band;
  score: number;
  vow: VowName | null;
  fired: VowName[];
  /** the two parts the band is the lower of: the score band (REVIEW under silence) and the deciding vow's band */
  score_band: Band;
  vow_band: Band;
}

export function policyBand(s: PayeeSignals, price: number | null, labels: Record<string, FunderLabel>, eVersion: "v1" | "v2" = "v2", windowH?: number): PolicyResult {
  const sc = score(components(s, labels, eVersion, windowH));
  // v1 required token concentration; v2 requires top_payer_share. Silence follows the version's E input.
  const probe = eVersion === "v1" ? { ...s, top_payer_share: s.token_asset_share } : s;
  const rows = evaluateVows({ signals: probe, price, funder_labels: labels });
  const silence = rows.find((r) => r.vow === "silence")!.fired;
  const dv = decidingVow(rows);
  const scoreBand: Band = silence ? "REVIEW" : bandForScore(sc);
  const vowBand: Band = dv?.band ?? "ALLOW";
  return { band: minBand(scoreBand, vowBand), score: sc, vow: dv?.vow ?? null, fired: rows.filter((r) => r.fired).map((r) => r.vow), score_band: scoreBand, vow_band: vowBand };
}

export interface BandDiff {
  n: number;
  changed: { payee: string; v1: Band; v2: Band; v1Score: number; v2Score: number }[];
  v1: Record<Band, number>;
  v2: Record<Band, number>;
}

export function diffE(items: { s: PayeeSignals; price: number | null }[], labels: Record<string, FunderLabel>, windowH?: number): BandDiff {
  const v1 = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<Band, number>;
  const v2 = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<Band, number>;
  const changed: BandDiff["changed"] = [];
  for (const { s, price } of items) {
    const a = policyBand(s, price, labels, "v1", windowH);
    const b = policyBand(s, price, labels, "v2", windowH);
    v1[a.band]++;
    v2[b.band]++;
    if (a.band !== b.band) changed.push({ payee: s.payee, v1: a.band, v2: b.band, v1Score: a.score, v2Score: b.score });
  }
  return { n: items.length, changed, v1, v2 };
}
