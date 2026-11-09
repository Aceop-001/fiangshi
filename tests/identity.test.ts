import { describe, it, expect } from "vitest";
import { corroborate, identityLevel, tokens } from "../src/core/identity.js";
import { components, score } from "../src/core/score.js";
import { evaluateVows } from "../src/core/vows.js";
import { clean, LABELS } from "./helpers.js";

describe("identity v3 corroboration sources", () => {
  it("catalog claim matching the URL host -> host", () => {
    expect(corroborate({ claims: ["Acme"], claimFrom: "catalog", url: "https://acme.example.com/v1/q" })).toEqual(["host"]);
  });
  it("path segment match -> path", () => {
    expect(corroborate({ claims: ["Crustdata"], claimFrom: "catalog", url: "https://agents.withzero.xyz/api/v1/crustdata/person" })).toEqual(["path"]);
  });
  it("label agreement adds a second source", () => {
    expect(corroborate({ claims: ["Glassnode"], claimFrom: "catalog", url: "https://x402.glassnode.com/v1", labelName: "Glassnode" })).toEqual(["host", "label"]);
  });
  it("a claim is never corroborated by its own source (catalog claim vs catalog name)", () => {
    expect(corroborate({ claims: ["Acme"], claimFrom: "catalog", catalogName: "Acme" })).toEqual([]);
  });
  it("generic words do not corroborate ('x402 API Tool' vs x402.example)", () => {
    expect(tokens("x402 API Tool")).toEqual([]);
    expect(corroborate({ claims: ["x402 API Tool"], claimFrom: "catalog", url: "https://x402.example/api" })).toEqual([]);
  });
  it("unrelated claim -> no sources (self-claim only)", () => {
    expect(corroborate({ claims: ["Toolsmith"], claimFrom: "catalog", url: "https://toolcall.click/t/fx/rates" })).toEqual([]);
  });
  it("levels", () => {
    expect([identityLevel(false, [], null), identityLevel(true, [], false), identityLevel(true, ["host"], true), identityLevel(true, ["host", "label"], true)]).toEqual([null, null, 0.5, 0.75]);
  });
});

describe("regression: self-claims are never penalised for existing", () => {
  const base = clean({ identity: { claims_org: null, claims_product: null, corroborated: null } });
  it('payee listing "Acme" at acme.example.com scores >= the same payee with no listing at all', () => {
    const sources = corroborate({ claims: ["Acme"], claimFrom: "catalog", url: "https://acme.example.com/v1" });
    const listed = { ...base, identity: { claims_org: "Acme", claims_product: null, corroborated: sources.length > 0, sources } };
    expect(score(components(listed, LABELS))).toBeGreaterThanOrEqual(score(components(base, LABELS)));
  });
  it("an uncorroborated self-claim scores EXACTLY like no claim, and fires no vow (examination never penalises)", () => {
    const listed = { ...base, identity: { claims_org: "Zzz", claims_product: null, corroborated: false, sources: [] } };
    expect(score(components(listed, LABELS))).toBe(score(components(base, LABELS)));
    const fired = (s: typeof base) => evaluateVows({ signals: s, price: 0.05, funder_labels: LABELS }).filter((r) => r.fired).map((r) => r.vow);
    expect(fired(listed)).toEqual(fired(base));
  });
  it("a contradicted claim is the only identity outcome that BLOCKs", () => {
    const c = { ...base, identity: { claims_org: "Acme", claims_product: null, corroborated: false, sources: [], contradicted: true } };
    const v = evaluateVows({ signals: c, price: 0.05, funder_labels: LABELS }).find((r) => r.vow === "identity")!;
    expect(v).toMatchObject({ fired: true, band: "BLOCK" });
  });
});
