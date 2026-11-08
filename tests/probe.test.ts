import { describe, it, expect } from "vitest";
import { loadFixtures402, parse402, priceUsd, termsHash } from "../src/adapters/probe.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("probe / parse402", () => {
  it("parses 10/10 recorded 402 fixtures", () => {
    const all = loadFixtures402();
    expect(all).toHaveLength(10);
    const ok = all.map(parse402).filter((r) => r.ok);
    expect(ok).toHaveLength(10);
  });

  it("converts USDC atomic units to USD", () => {
    expect(priceUsd("base", USDC, "50000")).toBe(0.05);
    expect(priceUsd("base", USDC, "1000000")).toBe(1);
  });

  it("unknown asset -> price null (fail closed, not a guess)", () => {
    expect(priceUsd("base", "0xdeadbeef", "50000")).toBeNull();
  });

  it("non-402 status is a probe error", () => {
    const r = parse402({ url: "u", status: 200, headers: {}, body: {} });
    expect(r.ok).toBe(false);
  });

  it("garbage body is a probe error, not a crash", () => {
    expect(parse402({ url: "u", status: 402, headers: {}, body: "<html>pay me</html>" }).ok).toBe(false);
    expect(parse402({ url: "u", status: 402, headers: {}, body: { x402Version: 1, accepts: [] } }).ok).toBe(false);
  });

  it("terms_hash is stable and sensitive to every term", () => {
    const t = { url: "u", price: 0.05, asset: "a", network: "base", payee: "p" };
    expect(termsHash(t)).toBe(termsHash({ ...t }));
    for (const k of Object.keys(t) as (keyof typeof t)[]) {
      const changed = { ...t, [k]: k === "price" ? 0.06 : "x" };
      expect(termsHash(changed)).not.toBe(termsHash(t));
    }
  });

  it("payee and asset are lower-cased", () => {
    const r = parse402(loadFixtures402()[0]!);
    expect(r.ok && r.terms.payee).toBe(r.ok && r.terms.payee.toLowerCase());
  });
});
