import { describe, it, expect, beforeEach } from "vitest";
import { loadCensus } from "../src/census.js";
import { coldCacheHit, coldSignals, type ColdFetcher } from "../src/cold.js";
import type { SurfPayeeRow } from "../src/adapters/surf.js";
import { tmp } from "./helpers.js";

const NOW = new Date("2026-11-11T12:00:00Z");
const t = Math.floor(NOW.getTime() / 1000);
const PAYEE = "0x1111111111111111111111111111111111111111";

/** A fake Surf: counts calls, charges 4 credits each, returns one plausible row. */
function fakeSurf(balance: number, opts: { fail?: string; funder?: string } = {}) {
  const state = { balance, fetches: 0, sqlCalls: 0 };
  const fetcher: ColdFetcher = {
    balance: () => state.balance,
    async fetch(payee: string) {
      state.fetches++;
      if (opts.fail) throw new Error(opts.fail);
      state.sqlCalls += 2;
      state.balance -= 8;
      const row: SurfPayeeRow = {
        payee,
        first_inbound_at: t - 40 * 86_400,
        last_inbound_at: t - 3600,
        inbound_count: 120,
        distinct_inbound_senders: 60,
        first_inbound_from: opts.funder ?? "0x2222222222222222222222222222222222222222",
        inbound_usd: 300,
        top_token_share: 1,
        top_payer_share: 0.1,
        first_outbound_at: t - 30 * 86_400,
        last_outbound_at: t - 7200,
        outbound_count: 4,
      } as SurfPayeeRow;
      return { row, calls: 2 };
    },
  };
  return { state, fetcher };
}

describe("cold check (payee outside the census)", () => {
  const c = loadCensus();
  beforeEach(() => {
    process.env.FIANGSHI_DATA_DIR = tmp();
    delete process.env.FIANGSHI_SURF_FLOOR;
  });

  it("first check makes exactly 2 Surf calls; the same payee again makes ZERO (cache, 72 h TTL)", async () => {
    const { state, fetcher } = fakeSurf(1000);
    const a = await coldSignals(PAYEE, "eip155:8453", c, fetcher, NOW);
    expect(a).toMatchObject({ ok: true, source: "surf", surf_calls: 2, credits_before: 1000, credits_after: 992 });
    expect(coldCacheHit(PAYEE, NOW)).toBe(true);
    const b = await coldSignals(PAYEE, "base", c, fetcher, new Date(NOW.getTime() + 3600_000));
    expect(b).toMatchObject({ ok: true, source: "cache", surf_calls: 0 });
    expect(state.fetches).toBe(1);
    expect(state.sqlCalls).toBe(2);
    if (a.ok && b.ok) expect(b.signals).toEqual({ ...a.signals, wallet_age_hours: a.signals.wallet_age_hours, dormancy_days: a.signals.dormancy_days });
  });
  it("after 72 h the cache expires and the payee is fetched again", async () => {
    const { state, fetcher } = fakeSurf(1000);
    await coldSignals(PAYEE, "base", c, fetcher, NOW);
    const later = new Date(NOW.getTime() + 73 * 3600_000);
    expect(coldCacheHit(PAYEE, later)).toBe(false);
    await coldSignals(PAYEE, "base", c, fetcher, later);
    expect(state.fetches).toBe(2);
  });
  it("the credit floor is checked BEFORE spending: no call when 8 credits would cross it", async () => {
    const { state, fetcher } = fakeSurf(39);
    const r = await coldSignals(PAYEE, "base", c, fetcher, NOW);
    expect(r).toMatchObject({ ok: false, reason: "budget_guard", surf_calls: 0 });
    expect(state.fetches).toBe(0);
    process.env.FIANGSHI_SURF_FLOOR = "20";
    expect((await coldSignals(PAYEE, "base", c, fetcher, NOW)).ok).toBe(true);
  });
  it("a budget-guard refusal or a Surf error fails closed, with nothing cached", async () => {
    const guard = await coldSignals(PAYEE, "base", c, fakeSurf(1000, { fail: "budget guard: surf cap 150 reached" }).fetcher, NOW);
    expect(guard).toMatchObject({ ok: false, reason: "budget_guard" });
    const err = await coldSignals(PAYEE, "base", c, fakeSurf(1000, { fail: "surf: QUERY_FAILED" }).fetcher, NOW);
    expect(err).toMatchObject({ ok: false, reason: "surf_error" });
    expect(coldCacheHit(PAYEE, NOW)).toBe(false);
  });
  it("Base only: another network is refused before any call; an unreadable balance is 'unavailable'", async () => {
    const { state, fetcher } = fakeSurf(1000);
    expect(await coldSignals(PAYEE, "eip155:1", c, fetcher, NOW)).toMatchObject({ ok: false, reason: "network_not_base" });
    expect(await coldSignals(PAYEE, "base", c, { ...fetcher, balance: () => null }, NOW)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(state.fetches).toBe(0);
  });
  it("kinship fanout is counted against the census, so a cold payee on a known ring funder is caught", async () => {
    const ring = c.funders.find((f) => f.kinship_fires && f.payees < 21)!;
    const r = await coldSignals(PAYEE, "base", c, fakeSurf(1000, { funder: ring.funder }).fetcher, NOW);
    expect(r.ok && r.signals.funder_fanout).toBe(ring.payees);
  });
});
