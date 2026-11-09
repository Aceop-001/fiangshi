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

  it("I identity v3: 0 claims 0 · self-claim 0.25 · +1 source 0.5 · +2 sources 0.75", () => {
    const anon = { claims_org: null, claims_product: null, corroborated: null };
    expect(identityScore(clean({ identity: anon }))).toBe(0);
    expect(identityScore(clean({ identity: { claims_org: "Acme", claims_product: null, corroborated: false, sources: [] } }))).toBe(0.25);
    expect(identityScore(clean({ identity: { claims_org: "Acme", claims_product: null, corroborated: true, sources: ["host"] } }))).toBe(0.5);
    expect(identityScore(clean({ identity: { claims_org: "Acme", claims_product: null, corroborated: true, sources: ["host", "label"] } }))).toBe(0.75);
    expect(identityScore(clean({ identity: { claims_org: "Acme", claims_product: null, corroborated: true, sources: ["host", "path", "label"] } }))).toBe(0.75);
    expect(identityScore(clean({ identity: { claims_org: "Acme", claims_product: null, corroborated: true } }))).toBe(0.5); // legacy: no source list
  });

  // E v2 = min(1, log10(payers+1)/2) × (1 − max(0, top − 0.30)/0.70); points = 10 × E
  const E = (payers: number, top: number) => exposure(clean({ first_funder: "0xnew", distinct_payers: payers, top_payer_share: top }), LABELS)!;

  it("E v2: 1 payer -> breadth factor 0.1505; as SOLE payer (top 100%) the concentration factor zeroes it", () => {
    expect(E(1, 0.3)).toBeCloseTo(Math.log10(2) / 2, 4); // 0.1505 -> 1.51 pts
    expect(E(1, 1.0)).toBe(0); // a single payer always holds 100% of inbound
  });
  it("E v2: 10 payers at 40% top -> 0.4463 (4.46 pts)", () => {
    expect(E(10, 0.4)).toBeCloseTo((Math.log10(11) / 2) * (1 - 0.1 / 0.7), 6);
    expect(10 * E(10, 0.4)).toBeCloseTo(4.46, 2);
  });
  it("E v2: 100 payers balanced -> 1.0 (10 pts)", () => {
    expect(10 * E(100, 0.05)).toBe(10);
  });
  it("E v2: no penalty up to 30% top share; 0 payers -> 0; missing inputs -> null", () => {
    expect(E(99, 0.3)).toBe(1);
    expect(E(0, 0)).toBe(0);
    expect(exposure(clean({ top_payer_share: null }), LABELS)).toBeNull();
    expect(exposure(clean({ distinct_payers: null }), LABELS)).toBeNull();
  });
  it("E v2: a labelled-exchange first funder is not counted as a payer", () => {
    const viaCex = exposure(clean({ first_funder: "0xcex", distinct_payers: 10, top_payer_share: 0.1 }), LABELS)!;
    expect(viaCex).toBeCloseTo(Math.log10(10) / 2, 6); // 9 payers, not 10
  });
  it("E v2 ignores token_asset_share (USDC-only seller is not penalised)", () => {
    expect(exposure(clean({ token_asset_share: 1 }), LABELS)).toBe(exposure(clean({ token_asset_share: 0 }), LABELS));
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

describe("M maturity, windowed two-tier (90-day audit dataset)", () => {
  const W = 90 * 24;
  it("age at the window floor counts as established: full age credit", () => {
    expect(maturity(clean({ wallet_age_hours: W, tx_count: 0 }), W)).toBe(0.5);
    expect(maturity(clean({ wallet_age_hours: W - 23, tx_count: 0 }), W)).toBe(0.5); // within a day of the floor
  });
  it("younger than the window: log curve up to the window, strictly below established", () => {
    const young = maturity(clean({ wallet_age_hours: 24 * 7, tx_count: 0 }), W)!;
    expect(young).toBeGreaterThan(0);
    expect(young).toBeLessThan(0.5);
  });
  it("default (no window) is the unchanged 1-year curve", () => {
    expect(maturity(clean({ wallet_age_hours: W, tx_count: 0 }))).toBeLessThan(0.5);
  });
  it("volume half is the same either way", () => {
    const a = maturity(clean({ wallet_age_hours: W, tx_count: 1000 }), W)! - maturity(clean({ wallet_age_hours: W, tx_count: 0 }), W)!;
    expect(a).toBeCloseTo(0.5, 6);
  });
});
