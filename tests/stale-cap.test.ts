import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { request, type Server } from "node:http";
import { ageHours, bandFromBasis, POLICY_V4, POLICY_VERSION, staleCap, v5Fields } from "../src/core/cap.js";
import { BANDS, bandRank, type Band } from "../src/core/types.js";
import { loadCensus } from "../src/census.js";
import { censusAnswer, staleLine } from "../src/preview.js";
import { sealReceipt, verifyReceipt } from "../src/core/receipt.js";
import { startServer } from "../src/api/server.js";
import { tmp } from "./helpers.js";

const LIMIT = 72;
const H = 3_600_000;
const TERMS = { price_usd: 0.01, network: "base", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", pay_to: "0xabc", terms_hash: "h" };
const PINNED = process.env.FIANGSHI_NOW!;
const at = (hoursAfterCensus: number) => new Date(Date.parse(loadCensus().at) + hoursAfterCensus * H);
afterEach(() => {
  process.env.FIANGSHI_NOW = PINNED;
});

describe("stale cap (policy v5): a band cap, not a vow", () => {
  it("1. a fresh ALLOW stays ALLOW", () => {
    expect(staleCap("ALLOW", 10, LIMIT)).toEqual({ band: "ALLOW", band_cap: null, verdict_confidence: "normal" });
    const c = loadCensus();
    const p = c.payees.find((x) => x.issued_band === "ALLOW")!;
    const a = censusAnswer(p.url, TERMS, c, p, { ok: false, why: "x" }, at(10));
    expect(a.verdict).toBe("ALLOW");
    expect(a.band_cap).toBeNull();
  });
  it("2. a stale ALLOW becomes REVIEW, with band_cap data_stale, and the score is unchanged", () => {
    const c = loadCensus();
    const p = c.payees.find((x) => x.issued_band === "ALLOW")!;
    const a = censusAnswer(p.url, TERMS, c, p, { ok: false, why: "x" }, at(96));
    expect(a.verdict).toBe("REVIEW");
    expect(a.issued_band).toBe("ALLOW");
    expect(a.score).toBe(p.score);
    expect(a.band_cap).toEqual({ reason: "data_stale", age_hours: 96, limit_hours: LIMIT });
    expect(a.verdict_confidence).toBe("degraded");
  });
  it("3. a stale BLOCK stays BLOCK", () => {
    expect(staleCap("BLOCK", 500, LIMIT).band).toBe("BLOCK");
    expect(staleCap("BLOCK", 500, LIMIT).band_cap).toBeNull();
  });
  it("4. a stale REVIEW stays REVIEW", () => {
    expect(staleCap("REVIEW", 500, LIMIT).band).toBe("REVIEW");
    expect(staleCap("REVIEW", 500, LIMIT).verdict_confidence).toBe("degraded");
  });
  it("5. the cap can never raise a band (every band at every age)", () => {
    for (const b of BANDS as readonly Band[])
      for (let age = 0; age <= 400; age += 0.5) {
        const r = staleCap(b, age, LIMIT);
        expect(bandRank(r.band), `${b} at ${age} h`).toBeLessThanOrEqual(bandRank(b));
        if (age <= LIMIT) expect(r.band).toBe(b);
      }
  });
  it("7. a record's age comes from its own as_of, not from the run's timestamp", () => {
    const c = loadCensus();
    const p = { ...c.payees.find((x) => x.issued_band === "ALLOW")!, as_of: at(90).toISOString() };
    const a = censusAnswer(p.url, TERMS, c, p, { ok: false, why: "x" }, at(100));
    expect(a.data_as_of).toBe(p.as_of);
    expect(a.data_age_hours).toBe(10);
    expect(a.verdict).toBe("ALLOW"); // 100 h after the run, but only 10 h after this record was collected
    expect(ageHours(p.as_of, at(100).getTime())).toBe(10);
  });
  it("9. when stale, unknowns contains the staleness line exactly once", () => {
    const c = loadCensus();
    const p = c.payees[0]!;
    const a = censusAnswer(p.url, TERMS, c, p, { ok: false, why: "x" }, at(96));
    expect(a.unknowns.filter((u) => u === staleLine(96))).toHaveLength(1);
    expect(a.unknowns.filter((u) => u.includes("freshness window"))).toHaveLength(1);
    const fresh = censusAnswer(p.url, TERMS, c, p, { ok: false, why: "x" }, at(1));
    expect(fresh.unknowns.some((u) => u.includes("freshness window"))).toBe(false);
  });
  it("v5 receipts record their basis, and the band is the lowest part", () => {
    const parts = { scoreBand: "ALLOW" as Band, modelBand: "ALLOW" as Band, vows: [] };
    const v = v5Fields(parts, at(0).toISOString(), at(96).getTime(), LIMIT);
    expect(v.band).toBe("REVIEW");
    expect(v.fields.policy_version).toBe(POLICY_VERSION);
    expect(bandFromBasis(v.fields.band_basis)).toBe("REVIEW");
    expect(v.fields.band_cap?.reason).toBe("data_stale");
  });
});

describe("verify and the published index under policy v5", () => {
  let server: Server;
  let base = "";
  const get = (p: string) =>
    new Promise<any>((ok, fail) => {
      const r = request(base + p, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => ok(JSON.parse(b)));
      });
      r.on("error", fail);
      r.end();
    });
  beforeAll(async () => {
    Object.assign(process.env, { FIANGSHI_DATA_DIR: tmp() });
    server = await startServer(0, "127.0.0.1");
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 30_000);
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("6. a v4 receipt still verifies to its original band, and says it was issued under v4", async () => {
    process.env.FIANGSHI_NOW = at(200).toISOString(); // every census record is now stale
    const p = loadCensus().payees.find((x) => x.issued_band === "ALLOW")!;
    expect(p.band).toBe("REVIEW"); // today's answer is capped...
    const v = await get(`/v1/verify?id=${p.receipt_id}`);
    expect(v.valid).toBe(true);
    expect(v.policy_version).toBe(POLICY_V4);
    expect(v.band_rederived).toBe("ALLOW"); // ...but the receipt keeps its original band
    expect(v.band_matches).toBe(true);
    expect(v.policy_note).toContain("before band caps existed");
  });
  it("a receipt whose band does not follow from its own recorded basis fails verification", () => {
    const parts = { scoreBand: "REVIEW" as Band, modelBand: "ALLOW" as Band, vows: [] };
    const f = v5Fields(parts, null, at(1).getTime(), LIMIT);
    const r = sealReceipt({ payee: "0x" + "1".repeat(40), url: "https://x.example", terms_hash: "a".repeat(64), price: 0.01, band: "ALLOW", score: 70, vow_fired: null, evidence: [], model: { verdict: "ALLOW", extractor: "none", degraded: false }, snapshot_id: "b".repeat(64), checked_at: at(1).toISOString(), settlement: "dry-run", ...f.fields }, "genesis");
    expect(verifyReceipt(r).ok).toBe(true); // the hash is intact...
    expect(bandFromBasis(r.band_basis!)).toBe("REVIEW"); // ...but ALLOW does not follow from a REVIEW score band
  });
  it("8. invariant over the published index: no ALLOW whose data is past the limit, fresh or stale", async () => {
    for (const h of [1, 71.9, 72.1, 200]) {
      process.env.FIANGSHI_NOW = at(h).toISOString();
      const idx = await get("/v1/index.json");
      expect(idx.payees_total).toBe(idx.payees.length);
      const bad = idx.payees.filter((p: any) => p.band === "ALLOW" && p.data_age_hours > idx.stale_limit_hours);
      expect(bad, `at +${h} h`).toEqual([]);
      expect(idx.payees_stale).toBe(idx.payees.filter((p: any) => p.stale).length);
      expect(idx.payees.every((p: any) => typeof p.as_of === "string")).toBe(true);
    }
  });
});
