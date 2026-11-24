/**
 * Task 1 (2026-11-24): ALLOW-only overlays and GET /v1/census/status. Uses the committed overlay
 * fixtures/audit/sample-allow-20261124T1304.json (159 payees re-collected at 13:04-13:05 UTC, 40 credits).
 */
import { describe, it, expect, afterEach } from "vitest";
import { loadCensus, applicableOverlays, currentRefreshSample, CENSUS_DAYS } from "../src/census.js";
import { censusStatus, readRuns, type RefreshRun } from "../src/census-status.js";
import { referenceTime } from "../src/reference-time.js";

const OVERLAY_AT = "2026-11-24T13:05:25.014Z"; // newest collection time in the overlay
const saved = process.env.FIANGSHI_NOW;
afterEach(() => {
  if (saved === undefined) delete process.env.FIANGSHI_NOW;
  else process.env.FIANGSHI_NOW = saved;
});
const at = (iso: string) => {
  process.env.FIANGSHI_NOW = iso;
  return loadCensus();
};

describe("ALLOW-only overlays", () => {
  it("never apply before their collection time: the published reference census is unchanged", () => {
    const c = at(referenceTime());
    expect(applicableOverlays(currentRefreshSample(CENSUS_DAYS)!, Date.parse(referenceTime()))).toEqual([]);
    expect(c.bands).toEqual({ ALLOW: 159, REVIEW: 1243, BLOCK: 521 });
  });
  it("apply once the clock passes them: every ALLOW is fresh, nothing is capped, the census time moves", () => {
    const c = at("2026-11-24T14:00:00.000Z");
    expect(c.at).toBe(OVERLAY_AT);
    const allow = c.payees.filter((p) => p.band === "ALLOW");
    expect(allow.length).toBe(105);
    expect(allow.every((p) => p.band_cap === null && !p.stale && p.as_of >= "2026-11-24T13:04")).toBe(true);
    expect(c.payees.filter((p) => p.issued_band === "ALLOW" && p.band_cap).length).toBe(0);
    expect(c.payees.length).toBe(1923);
  });
  it("do not fabricate freshness: payees outside the overlay keep their own 20 Nov as_of and stay stale", () => {
    const c = at("2026-11-24T14:00:00.000Z");
    expect(c.payees_stale).toBe(1764);
    const old = c.payees.filter((p) => p.as_of < "2026-11-21");
    expect(old.length).toBe(1764);
    expect(old.every((p) => p.stale)).toBe(true);
  });
  it("the full refresh's receipts keep verifying after an overlay supersedes them", () => {
    const before = at(referenceTime()).ledger.map((r) => r.receipt_hash);
    const c = at("2026-11-24T14:00:00.000Z");
    expect(before.every((id) => c.receipts.has(id))).toBe(true);
    expect(c.chains.some((l) => l.length === before.length && l[0]!.receipt_hash === before[0])).toBe(true);
  });
  it("past the 72 h limit the overlay's ALLOWs are capped too (the cap still works)", () => {
    const c = at("2026-11-28T14:00:00.000Z");
    expect(c.bands.ALLOW).toBe(0);
  });
});

describe("GET /v1/census/status", () => {
  const run = (atIso: string, complete = true): RefreshRun => ({ at: atIso, kind: "allow-only", payees_targeted: 159, payees_refreshed: complete ? 159 : 0, payees_failed: complete ? 0 : 159, credits_spent: complete ? 40 : 0, complete });
  it("next refresh is the last complete run plus the interval; incomplete runs do not count", () => {
    const c = at("2026-11-24T14:00:00.000Z");
    const s = censusStatus(c, [run("2026-11-24T13:04:20.554Z"), run("2026-11-25T00:00:00.000Z", false)], Date.parse("2026-11-24T14:00:00Z"), 36);
    expect(s.next_refresh_at).toBe("2026-11-26T01:04:20.554Z");
    expect(s.overdue).toBe(false);
    expect(s.last_run).toMatchObject({ credits_spent: 40, payees_refreshed: 159, payees_failed: 0 });
    expect([s.records_total, s.records_stale, s.allow_issued, s.allow_served, s.allow_capped]).toEqual([1923, 1764, 105, 105, 0]);
  });
  it("a missed refresh reads overdue, never fresh", () => {
    const c = at("2026-11-27T00:00:00.000Z");
    const s = censusStatus(c, [run("2026-11-24T13:04:20.554Z")], Date.parse("2026-11-27T00:00:00Z"), 36);
    expect(s.overdue).toBe(true);
  });
  it("the committed run log has the first ALLOW-only run", () => {
    expect(readRuns().find((r) => r.complete)).toMatchObject({ kind: "allow-only", payees_refreshed: 159, payees_failed: 0, credits_spent: 40 });
  });
});
