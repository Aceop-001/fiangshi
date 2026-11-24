/**
 * GET /v1/census/status (2026-11-24): how fresh the census is right now, and what the last refresh did.
 * Read-only and computed from the served census plus fixtures/audit/refresh-runs.json (written by the refresh scripts).
 * `next_refresh_at` is the planned time (last run + FIANGSHI_REFRESH_HOURS); the API cannot see whether the scheduler that
 * runs the refresh is installed, so a missed run shows as `overdue: true`, never as fresh data.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, num } from "./config.js";
import type { Census } from "./census.js";

export interface RefreshRun {
  at: string;
  finished_at?: string;
  kind: "allow-only" | "full";
  overlay?: string;
  payees_targeted: number;
  payees_refreshed: number;
  payees_failed: number;
  credits_spent: number | null;
  complete: boolean;
}

export const refreshHours = () => num("FIANGSHI_REFRESH_HOURS", 36);
const RUNS = () => join(ROOT, "fixtures", "audit", "refresh-runs.json");

export function readRuns(path = RUNS()): RefreshRun[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as RefreshRun[]) : [];
}

export function censusStatus(c: Census, runs: RefreshRun[], nowMs: number, intervalH = refreshHours()) {
  const last = [...runs].filter((r) => r.complete).sort((a, b) => a.at.localeCompare(b.at)).pop() ?? null;
  const from = Date.parse(last?.at ?? c.at);
  const next = new Date(from + intervalH * 3_600_000).toISOString();
  const issuedAllow = c.payees.filter((p) => p.issued_band === "ALLOW");
  return {
    census_at: c.at,
    served_at: new Date(nowMs).toISOString(),
    records_total: c.payees.length,
    records_stale: c.payees_stale,
    stale_limit_hours: c.stale_limit_hours,
    allow_issued: issuedAllow.length,
    allow_served: c.bands.ALLOW,
    allow_capped: issuedAllow.filter((p) => p.band_cap).length,
    refresh_interval_hours: intervalH,
    next_refresh_at: next,
    overdue: nowMs > Date.parse(next),
    last_run: last
      ? { at: last.at, kind: last.kind, credits_spent: last.credits_spent, payees_refreshed: last.payees_refreshed, payees_failed: last.payees_failed }
      : null,
    note: "ALLOW-only refreshes keep every issued ALLOW inside the freshness window; REVIEW and BLOCK records are capped the same either way and wait for the next full refresh, so records_stale stays high between full refreshes.",
  };
}
