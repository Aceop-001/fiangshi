/**
 * Cold check (final pass, 2026-11-11): signals for a payee that is NOT in the 800-payee census.
 *   1. Cache: data/cold-cache.json, 72 h TTL (FIANGSHI_POLICY_TTL_HOURS). A hit makes zero Surf calls.
 *   2. Otherwise exactly two Surf calls for this one address, 90-day window: payee-inbound + payee-outbound
 *      (scripts/surf/*.sql), through the budget guard (scripts/budget.ts). Billed 4 credits each by balance.
 *   3. Before spending: the balance must stay at or above the floor (FIANGSHI_SURF_FLOOR, default 32) after 8 credits.
 * Fail closed: any refusal, error or missing data returns a reason and NO signals; the caller answers REVIEW.
 * Base only: terms on any other network are refused before any call (no silent Base assumption).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, num, policyTtlHours } from "./config.js";
import { signalsFromSurf, type SurfPayeeRow } from "./adapters/surf.js";
import type { PayeeSignals } from "./core/types.js";
import type { Census } from "./census.js";

export const COLD_DAYS = 90;
export const COLD_SURF_CALLS = 2;
export const COLD_CREDITS_PER_CALL = 4; // balance delta per keyed sync SQL call (meta.credits_used says 5)
export const BASE_NETWORKS = new Set(["base", "eip155:8453"]);

/** One fetch = the two SQL calls for one address. Injected in tests; the default shells out to the Surf CLI. */
export interface ColdFetcher {
  balance(): number | null;
  fetch(payee: string, days: number): Promise<{ row: SurfPayeeRow; calls: number }>;
}

export type ColdResult =
  | { ok: true; signals: PayeeSignals; source: "cache" | "surf"; surf_calls: number; credits_before: number | null; credits_after: number | null; fetched_at: string }
  | { ok: false; reason: "budget_guard" | "surf_error" | "network_not_base" | "unavailable"; detail: string; surf_calls: number };

interface CacheEntry { fetched_at: string; row: SurfPayeeRow }
const cachePath = () => join(dataDir(), "cold-cache.json");
function readCache(): Record<string, CacheEntry> {
  try {
    return existsSync(cachePath()) ? (JSON.parse(readFileSync(cachePath(), "utf8")) as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}
function writeCache(c: Record<string, CacheEntry>) {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(cachePath(), JSON.stringify(c, null, 1));
}

/** True when this payee was fetched cold within the TTL: it is then served at the cached price with zero Surf calls. */
export function coldCacheHit(payee: string, now = new Date()): boolean {
  const hit = readCache()[payee.toLowerCase()];
  return Boolean(hit) && now.getTime() - Date.parse(hit!.fetched_at) < policyTtlHours() * 3_600_000;
}

/** Signals from a raw row, with kinship fanout counted against the census (the vow's own measure). */
export function coldSignalsFromRow(row: SurfPayeeRow, c: Census, fetchedAt: string): PayeeSignals {
  const now = Math.floor(Date.parse(fetchedAt) / 1000);
  const s = signalsFromSurf(row, { now, windowStart: now - COLD_DAYS * 86_400, tokenContracts: c.tokenContracts });
  if (!s.first_funder) return s;
  const fanout = c.payees.filter((p) => p.first_funder === s.first_funder && p.payee !== s.payee).length;
  return { ...s, funder_fanout: fanout };
}

export async function coldSignals(payee: string, network: string, c: Census, fetcher: ColdFetcher, now = new Date()): Promise<ColdResult> {
  const p = payee.toLowerCase();
  if (!BASE_NETWORKS.has(network.toLowerCase())) return { ok: false, reason: "network_not_base", detail: `payment network ${network} is not Base; no data source for it`, surf_calls: 0 };
  const cache = readCache();
  const hit = cache[p];
  if (hit && now.getTime() - Date.parse(hit.fetched_at) < policyTtlHours() * 3_600_000)
    return { ok: true, signals: coldSignalsFromRow(hit.row, c, hit.fetched_at), source: "cache", surf_calls: 0, credits_before: null, credits_after: null, fetched_at: hit.fetched_at };
  const floor = num("FIANGSHI_SURF_FLOOR", 32);
  const before = fetcher.balance();
  if (before === null) return { ok: false, reason: "unavailable", detail: "Surf balance could not be read, so the floor cannot be checked", surf_calls: 0 };
  if (before - COLD_SURF_CALLS * COLD_CREDITS_PER_CALL < floor)
    return { ok: false, reason: "budget_guard", detail: `balance ${before} - ${COLD_SURF_CALLS * COLD_CREDITS_PER_CALL} would fall below the ${floor}-credit floor`, surf_calls: 0 };
  let got: { row: SurfPayeeRow; calls: number };
  try {
    got = await fetcher.fetch(p, COLD_DAYS);
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, reason: /budget/i.test(msg) ? "budget_guard" : "surf_error", detail: msg.slice(0, 200), surf_calls: 0 };
  }
  const fetchedAt = now.toISOString();
  cache[p] = { fetched_at: fetchedAt, row: got.row };
  writeCache(cache);
  return { ok: true, signals: coldSignalsFromRow(got.row, c, fetchedAt), source: "surf", surf_calls: got.calls, credits_before: before, credits_after: fetcher.balance(), fetched_at: fetchedAt };
}
