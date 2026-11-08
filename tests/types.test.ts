import { describe, it, expect } from "vitest";
import { bandForScore, minBand } from "../src/core/types.js";
import { canonical } from "../src/core/canonical.js";

describe("types helpers", () => {
  it("band boundaries 49.99/50/79.99/80", () => {
    expect(bandForScore(49.99)).toBe("BLOCK");
    expect(bandForScore(50)).toBe("REVIEW");
    expect(bandForScore(79.99)).toBe("REVIEW");
    expect(bandForScore(80)).toBe("ALLOW");
  });
  it("minBand picks the most restrictive", () => {
    expect(minBand("ALLOW", "REVIEW")).toBe("REVIEW");
    expect(minBand("REVIEW", "BLOCK", "ALLOW")).toBe("BLOCK");
  });
  it("canonical sorts keys deterministically", () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
