/** Five deterministic vows. Pure. They run after the model and may only lower the band. */
import {
  REQUIRED_SIGNALS,
  VOW_NAMES,
  bandRank,
  type Band,
  type FunderLabel,
  type PayeeSignals,
  type VowName,
} from "./types.js";

export interface VowInput {
  signals: PayeeSignals; // sanitized
  price: number | null;
  funder_labels: Record<string, FunderLabel>;
}
export interface VowRow {
  vow: VowName;
  fired: boolean;
  band: Band; // band imposed when fired
  reason: string;
  signal: string; // evidence key backing the decision
}

export const AGE_MIN_H = 48;
export const KINSHIP_MIN = 3;
export const HISTORY_PRICE_USD = 0.5;
export const IDENTITY_AGE_H = 7 * 24;

type Rule = (i: VowInput) => Omit<VowRow, "vow">;

export const RULES: Record<VowName, Rule> = {
  age: ({ signals: s }) => ({
    fired: s.wallet_age_hours !== null && s.wallet_age_hours < AGE_MIN_H,
    band: "BLOCK",
    reason: `wallet_age_hours=${s.wallet_age_hours} (block if < ${AGE_MIN_H})`,
    signal: "wallet_age_hours",
  }),
  kinship: ({ signals: s, funder_labels }) => ({
    fired:
      s.funder_fanout !== null &&
      s.funder_fanout >= KINSHIP_MIN &&
      s.first_funder !== null &&
      funder_labels[s.first_funder] !== "cex",
    band: "BLOCK",
    reason: `funder shared with ${s.funder_fanout} other catalog payees (block if >= ${KINSHIP_MIN}, <=2 hops, non-CEX)`,
    signal: "first_funder",
  }),
  history: ({ signals: s, price }) => ({
    fired: s.distinct_payers === 0 && price !== null && price > HISTORY_PRICE_USD,
    band: "REVIEW",
    reason: `distinct_payers=${s.distinct_payers}, price=$${price} (review if 0 payers and > $${HISTORY_PRICE_USD})`,
    signal: "distinct_payers",
  }),
  identity: ({ signals: s }) => {
    const claims = Boolean(s.identity.claims_org || s.identity.claims_product);
    return {
      fired:
        claims &&
        s.identity.corroborated !== true &&
        s.wallet_age_hours !== null &&
        s.wallet_age_hours < IDENTITY_AGE_H,
      band: "BLOCK",
      reason: claims
        ? `claims "${s.identity.claims_org ?? s.identity.claims_product}", corroborated=${s.identity.corroborated}, age ${s.wallet_age_hours}h (block if uncorroborated and < ${IDENTITY_AGE_H}h)`
        : "no identity claims",
      signal: "identity",
    };
  },
  silence: ({ signals: s, price }) => {
    const missing: string[] = REQUIRED_SIGNALS.filter((k) => s[k] === null);
    if (price === null) missing.push("price");
    return {
      fired: missing.length > 0,
      band: "REVIEW",
      reason: missing.length ? `missing: ${missing.join(", ")}` : "all required signals present",
      signal: missing[0] ?? "payee",
    };
  },
};

export function evaluateVows(input: VowInput): VowRow[] {
  return VOW_NAMES.map((vow) => ({ vow, ...RULES[vow](input) }));
}

/** Most severe fired vow wins; ties broken by listed precedence. */
export function decidingVow(rows: VowRow[]): VowRow | null {
  let best: VowRow | null = null;
  for (const r of rows) {
    if (!r.fired) continue;
    if (best === null || bandRank(r.band) < bandRank(best.band)) best = r;
  }
  return best;
}
