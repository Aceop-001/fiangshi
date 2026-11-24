/**
 * GET /v1/stats (2026-11-24): public usage counters, computed from the receipts this server sealed, never estimated.
 * A receipt carries its fee (fee_usd) and its settlement, so usd_settled_24h is the sum of fees on receipts whose payment
 * the facilitator settled (each names its tx_hash). Free previews are counted in memory. Counts start when this process
 * started (the live ledger file is this process's own), and `counted_since` says so.
 */
import type { Receipt } from "./core/types.js";
import type { Head } from "./ledger/github.js";

const PROCESS_STARTED = Date.now();
const previews: number[] = [];
const DAY = 24 * 3_600_000;

/** record one free preview answer (kept for 24 h) */
export function countPreview(now = Date.now()): void {
  previews.push(now);
  while (previews.length && previews[0]! < now - DAY) previews.shift();
}

/**
 * `store`: the durable receipt store's HEAD as read at process start, when a store is set. Lifetime totals are that HEAD
 * plus what this process sealed since; without a store there are no lifetime totals, and the answer says why.
 */
export function usageStats(ledger: unknown[], nowMs: number, settlementMode: string, store: { head: Head | null; repo: string } | null = null) {
  const since = Math.max(nowMs - DAY, PROCESS_STARTED);
  const rows = (ledger as Receipt[]).filter((r) => r && typeof r.checked_at === "string" && Date.parse(r.checked_at) >= since);
  const paid = rows.filter((r) => (r.fee_usd ?? 0) > 0);
  const settled = paid.filter((r) => r.settlement === "settled" && r.tx_hash);
  const sum = (rs: Receipt[]) => Math.round(rs.reduce((a, r) => a + (r.fee_usd ?? 0), 0) * 1e6) / 1e6;
  const all = (ledger as Receipt[]).filter((r) => r && typeof r.checked_at === "string");
  const allPaid = all.filter((r) => (r.fee_usd ?? 0) > 0);
  const allSettled = allPaid.filter((r) => r.settlement === "settled" && r.tx_hash);
  const h = store?.head;
  const lifetime = store
    ? {
        source: `durable receipt store github.com/${store.repo}`,
        since: h?.started_at ?? (all[0]?.checked_at ?? null),
        receipts: (h?.count ?? 0) + all.length,
        paid_checks: (h?.paid ?? 0) + allPaid.length,
        settled_checks: (h?.settled ?? 0) + allSettled.length,
        usd_settled: Math.round(((h?.usd_settled ?? 0) + sum(allSettled)) * 1e6) / 1e6,
      }
    : { source: null, reason: "no receipt store is set (FIANGSHI_RECEIPTS_REPO), so counts cover this server process only, since counted_since; they reset on redeploy" };
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
    lifetime,
    settled_tx: [...new Set(settled.map((r) => r.tx_hash!))].slice(-20),
    note: "Counted from receipts this server process sealed since counted_since (paid checks and free null-payee blocks), plus free previews. usd_settled_24h only counts receipts whose payment the facilitator settled; each names its tx_hash on Base.",
  };
}
