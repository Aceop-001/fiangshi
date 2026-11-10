import { describe, it, expect } from "vitest";
import { contradicts, corroborate, identityLevel, operatorName, tokens } from "../src/core/identity.js";
import { components, score } from "../src/core/score.js";
import { evaluateVows } from "../src/core/vows.js";
import { censusIdentity } from "../scripts/audit.js";
import { signalsFromSurf } from "../src/adapters/surf.js";
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

describe("only an operator label can contradict a claim (2026-11-10)", () => {
  it("an exchange's own wallet names its operator, so an unrelated listing name is contradicted", () => {
    expect(operatorName({ entity_name: "Kraken", entity_type: "cex" })).toBe("Kraken");
    expect(contradicts(["Acme Weather"], operatorName({ entity_name: "Kraken", entity_type: "cex" }))).toBe(true);
    expect(contradicts(["Kraken Prices"], operatorName({ entity_name: "Kraken", entity_type: "cex" }))).toBe(false); // shares a word: not contradicted
  });
  it("a person's handle contradicts nothing: people sell products under other names (the live false positive)", () => {
    const handle = { entity_name: "@example_person", entity_type: "individual" };
    expect(operatorName(handle)).toBeNull();
    expect(contradicts(["Crawl Pre-Flight"], operatorName(handle))).toBe(false);
  });
  it("a deposit address names the platform, not the wallet's owner", () => {
    expect(operatorName({ entity_name: "Stake Deposit", entity_type: "casino_deposit" })).toBeNull();
    expect(operatorName({ entity_name: "OKX Deposit", entity_type: "cex" })).toBeNull();
    expect(contradicts(["Acme"], operatorName({ entity_name: "OKX Deposit", entity_type: "cex" }))).toBe(false);
  });
  it("a label of unknown kind, or no label, never BLOCKs", () => {
    expect(operatorName({ entity_name: "Somebody", entity_type: null })).toBeNull();
    expect(operatorName({ entity_name: null, entity_type: "cex" })).toBeNull();
    expect(operatorName(undefined)).toBeNull();
    expect(contradicts(["Acme"], null)).toBe(false);
  });
});

describe("a wallet label stands in as the seller's name only when it names the operator", () => {
  const payee = (service: string | null) => ({ payee: "0xabc", example_url: "https://seller.example/v1/data", service, price_usd: 0.01 }) as any;
  const label = (entity_name: string, entity_type: string) => ({ address: "0xabc", entity_name, entity_type }) as any;
  it("no catalog name + an operator label -> the label is the claim, backed by the label itself", () => {
    expect(censusIdentity(payee(null), label("Kraken", "cex"))).toMatchObject({ claims_org: "Kraken", corroborated: true, sources: ["label"] });
  });
  it("no catalog name + a person's handle or a deposit address -> no claim at all (and the handle is never published)", () => {
    expect(censusIdentity(payee(null), label("@example_person", "individual"))).toBeUndefined();
    expect(censusIdentity(payee(null), label("Stake Deposit", "casino_deposit"))).toBeUndefined();
    expect(censusIdentity(payee(null), label("OKX Deposit", "cex"))).toBeUndefined();
  });
  it("a catalog name is contradicted by an operator label only", () => {
    expect(censusIdentity(payee("Crawl Pre-Flight"), label("@example_person", "individual"))?.contradicted).toBe(false);
    expect(censusIdentity(payee("Crawl Pre-Flight"), label("Kraken", "cex"))?.contradicted).toBe(true);
  });
});

describe("identity evidence says where the name came from", () => {
  const row = { payee: "0xabc", first_inbound_at: 1_700_000_000, inbound_count: 3, outbound_count: 0, distinct_inbound_senders: 2 } as any;
  const ctx = { now: 1_700_100_000, windowStart: 1_690_000_000, tokenContracts: [] };
  const ev = (claimFrom?: "catalog" | "label") => signalsFromSurf(row, { ...ctx, identity: { claims_org: "Acme", corroborated: true, claimFrom } }).evidence.identity;
  it("catalog listing, Surf label, or unknown", () => {
    expect(ev("catalog")).toBe("catalog listing name: Acme");
    expect(ev("label")).toBe("surf label: Acme");
    expect(ev()).toBe("claimed name: Acme");
  });
  it("the census passes the source through", () => {
    expect(censusIdentity({ payee: "0xabc", example_url: "https://acme.example/v1", service: "Acme", price_usd: 0.01 } as any, undefined)?.claimFrom).toBe("catalog");
  });
});
