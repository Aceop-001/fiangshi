/**
 * GET /v1/stats (2026-11-24): public usage counters, computed from the receipts this server sealed, never estimated.
 * A receipt carries its fee (fee_usd) and its settlement, so usd_settled_24h is the sum of fees on receipts whose payment
 * the facilitator settled (each names its tx_hash). Free previews are counted in memory. Counts start when this process
 * started (the live ledger file is this process's own), and `counted_since` says so.
 */
import type { Receipt } from "./core/types.js";

const PROCESS_STARTED = Date.now();
const previews: number[] = [];
const DAY = 24 * 3_600_000;

/** record one free preview answer (kept for 24 h) */
export function countPreview(now = Date.now()): void {
  previews.push(now);
  while (previews.length && previews[0]! < now - DAY) previews.shift();
}

export function usageStats(ledger: unknown[], nowMs: number, settlementMode: string) {
  const since = Math.max(nowMs - DAY, PROCESS_STARTED);
  const rows = (ledger as Receipt[]).filter((r) => r && typeof r.checked_at === "string" && Date.parse(r.checked_at) >= since);
  const paid = rows.filter((r) => (r.fee_usd ?? 0) > 0);
  const settled = paid.filter((r) => r.settlement === "settled" && r.tx_hash);
  const sum = (rs: Receipt[]) => Math.round(rs.reduce((a, r) => a + (r.fee_usd ?? 0), 0) * 1e6) / 1e6;
  return {
    window_hours: 24,
    counted_since: new Date(since).toISOString(),
    checks_served_24h: rows.length,
    paid_checks_24h: paid.length,
    settled_checks_24h: settled.length,
    usd_settled_24h: sum(settled),
    usd_charged_dry_run_24h: sum(paid.filter((r) => r.settlement !== "settled")),
    free_previews_24h: previews.filter((t) => t >= since).length,
    settlement_mode: settlementMode,
    settled_tx: [...new Set(settled.map((r) => r.tx_hash!))].slice(-20),
    note: "Counted from receipts this server process sealed since counted_since (paid checks and free null-payee blocks), plus free previews. usd_settled_24h only counts receipts whose payment the facilitator settled; each names its tx_hash on Base.",
  };
}
