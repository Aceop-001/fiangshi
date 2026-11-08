import { describe, it, expect } from "vitest";
import { components, corroboration, exposure, identityScore, maturity, provenance, revenue, score, WEIGHTS } from "../src/core/score.js";
import { clean, LABELS } from "./helpers.js";

describe("score components: boundaries 0 / mid / 1 / missing", () => {
  it("weights sum to 100", () => expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100));

  it("M maturity: 0 at age 0 & tx 0, 1 at caps, mid between, null when missing", () => {
    expect(maturity(clean({ wallet_age_hours: 0, tx_count: 0 }))).toBe(0);
    expect(maturity(clean({ wallet_age_hours: 24 * 365 * 3, tx_count: 10_000 }))).toBe(1);
    const mid = maturity(clean({ wallet_age_hours: 100, tx_count: 30 }))!;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(maturity(clean({ tx_count: null }))).toBeNull();
  });

  it("P provenance: CEX 1 / fresh 0.6 / shared 0.2 / mixer 0 / missing null", () => {
    expect(provenance(clean(), LABELS)).toBe(1);
    expect(provenance(clean({ first_funder: "0xnew", funder_fanout: 0 }), LABELS)).toBe(0.6);
    expect(provenance(clean({ first_funder: "0xnew", funder_fanout: 2 }), LABELS)).toBe(0.2);
    expect(provenance(clean({ first_funder: "0xmixer" }), LABELS)).toBe(0);
    expect(provenance(clean({ first_funder: null }), LABELS)).toBeNull();
  });

  it("R revenue: 0 with no payers, 1 at caps, null when distinct missing", () => {
    expect(revenue(clean({ distinct_payers: 0, repeat_payers: 0 }))).toBe(0);
    expect(revenue(clean({ distinct_payers: 1000, repeat_payers: 500 }))).toBe(1);
    expect(revenue(clean({ distinct_payers: null }))).toBeNull();
  });

  it("I identity: corroborated 1, anonymous 0.5, uncorroborated claim 0", () => {
    expect(identityScore(clean())).toBe(1);
    expect(identityScore(clean({ identity: { claims_org: null, claims_product: null, corroborated: null } }))).toBe(0.5);
    expect(identityScore(clean({ identity: { claims_org: "Acme", claims_product: null, corroborated: false } }))).toBe(0);
  });

  it("E exposure: 1 - concentration, null when missing", () => {
    expect(exposure(clean({ token_concentration: 0 }))).toBe(1);
    expect(exposure(clean({ token_concentration: 1 }))).toBe(0);
    expect(exposure(clean({ token_concentration: 0.5 }))).toBe(0.5);
    expect(exposure(clean({ token_concentration: null }))).toBeNull();
  });

  it("C corroboration: share of evidence fields present", () => {
    expect(corroboration(clean())).toBe(1);
    expect(corroboration(clean({ evidence: {} }))).toBe(0);
    expect(corroboration(clean({ evidence: { wallet_age_hours: "x", tx_count: "y", identity: "z" } }))).toBe(0.5);
  });

  it("score: all components 1 => 100, missing components contribute 0", () => {
    expect(score({ M: 1, P: 1, R: 1, I: 1, E: 1, C: 1 })).toBe(100);
    expect(score({ M: null, P: null, R: null, I: 0, E: null, C: 0 })).toBe(0);
    expect(score({ M: 0.5, P: 0.5, R: 0.5, I: 0.5, E: 0.5, C: 0.5 })).toBe(50);
  });

  it("clean payee scores ALLOW range", () => expect(score(components(clean(), LABELS))).toBeGreaterThanOrEqual(80));
});
