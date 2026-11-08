import { describe, it, expect } from "vitest";
import { drift, isStale, type Observation } from "../src/ledger/drift.js";

const base: Observation = { url: "u", payee: "0xp", score: 85, price: 0.05, first_funder: "0xf", dormancy_days: 0, checked_at: "2026-11-08T00:00:00Z" };

describe("drift rules", () => {
  it("no change -> no events", () => expect(drift(base, base)).toEqual([]));
  it("crossing 80 -> band_cross_80", () => expect(drift(base, { ...base, score: 79 })).toEqual(["band_cross_80"]));
  it("crossing both 50 and 80", () => expect(drift(base, { ...base, score: 40 })).toEqual(["band_cross_50", "band_cross_80"]));
  it("same url, new payee -> payee_rotation", () => expect(drift(base, { ...base, payee: "0xnew" })).toContain("payee_rotation"));
  it("funder change -> funder_change", () => expect(drift(base, { ...base, first_funder: "0xg" })).toEqual(["funder_change"]));
  it("price +10% is not drift, +11% is", () => {
    expect(drift(base, { ...base, price: 0.055 })).toEqual([]);
    expect(drift(base, { ...base, price: 0.0556 })).toEqual(["price_drift"]);
  });
  it("dormant 60d then active -> dormancy_reactivation; 59d -> none", () => {
    expect(drift({ ...base, dormancy_days: 60 }, { ...base, dormancy_days: 0 })).toEqual(["dormancy_reactivation"]);
    expect(drift({ ...base, dormancy_days: 59 }, { ...base, dormancy_days: 0 })).toEqual([]);
  });
});

describe("policy decay", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  it("fresh within 72h", () => expect(isStale("2026-11-07T12:00:00Z", now, 72)).toBe(false));
  it("stale after 72h", () => expect(isStale("2026-11-05T11:00:00Z", now, 72)).toBe(true));
});
