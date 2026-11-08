import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { loadFixtures402, parse402 } from "../src/adapters/probe.js";

const real = () => loadFixtures402(join("fixtures", "402", "real"));

describe("probe: real recorded x402 v2 responses (fixtures/402/real)", () => {
  it("records >= 5 real 402s and parses all of them", () => {
    const all = real();
    expect(all.length).toBeGreaterThanOrEqual(5);
    const bad = all.map(parse402).filter((r) => !r.ok);
    expect(bad.map((b) => !b.ok && `${b.raw?.url}: ${b.error}`)).toEqual([]);
  });

  it("header-only v2 response (empty body) parses from payment-required", () => {
    const raw = real().find((r) => !(r.body && typeof r.body === "object" && "accepts" in (r.body as object)));
    expect(raw).toBeDefined();
    const p = parse402(raw!);
    expect(p.ok).toBe(true);
  });

  it("CAIP-2 eip155:8453 normalizes to base and USDC prices resolve", () => {
    const parsed = real().map(parse402).filter((r) => r.ok);
    for (const p of parsed) if (p.ok) expect(p.terms.network).toBe("base");
    expect(parsed.filter((p) => p.ok && p.terms.price !== null).length).toBeGreaterThanOrEqual(5);
  });

  it("garbage payment-required header is a probe error, not a crash", () => {
    expect(parse402({ url: "u", status: 402, headers: { "payment-required": "!!!not-base64-json" }, body: "" }).ok).toBe(false);
  });
});

describe("probe: multi-chain accepts[] (regression, 200-payee probe 2026-11-08)", () => {
  const un = () => loadFixtures402(join("fixtures", "audit", "unparsed"));
  it("a non-conforming alternative entry (Hyperliquid/XRPL decimal amount) no longer hides a valid Base option", () => {
    const fixed = un().map(parse402).filter((r) => r.ok);
    expect(fixed.length).toBe(5);
    for (const r of fixed) if (r.ok) expect(r.terms.network).toBe("base");
  });
  it("402s without any accepts[] still fail closed (not guessed)", () => {
    const still = un().map(parse402).filter((r) => !r.ok).map((r) => r.raw?.url);
    expect(still.sort()).toEqual(["https://graphadvocate.com/onchain-x402/address", "https://yieldsignal.vercel.app/signal/usdc-base-yield"]);
  });
});
