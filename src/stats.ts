/**
 * GET /v1/stats (2026-11-24): public usage counters, computed from the receipts this server sealed, never estimated.
 * A receipt carries its fee (fee_usd) and its settlement, so usd_settled_24h is the sum of fees on receipts whose payment
 * the facilitator settled (each names its tx_hash). Free previews are counted in memory. Counts start when this process
 * started (the live ledger file is this process's own), and `counted_since` says so. With a durable receipt store, the
 * receipts read back from it at start count too (2026-11-25): a restart no longer empties the 24 h window.
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
export function usageStats(localLedger: unknown[], nowMs: number, settlementMode: string, store: { head: Head | null; repo: string; history?: Receipt[] } | null = null) {
  // the store's history (read at start) plus this process's own receipts, each receipt once
  const seen = new Set<string>();
  const ledger = [...(store?.history ?? []), ...(localLedger as Receipt[])].filter((r) => r && !seen.has(r.receipt_hash) && seen.add(r.receipt_hash));
  const hasHistory = (store?.history?.length ?? 0) > 0 || (store?.head?.count ?? 0) === 0;
  // with the store's history the window is the real last 24 h; without it, counts start when this process started
  const since = store && hasHistory ? nowMs - DAY : Math.max(nowMs - DAY, PROCESS_STARTED);
  const local = (localLedger as Receipt[]).filter((r) => r && typeof r.checked_at === "string");
  const rows = (ledger as Receipt[]).filter((r) => r && typeof r.checked_at === "string" && Date.parse(r.checked_at) >= since);
  const paid = rows.filter((r) => (r.fee_usd ?? 0) > 0);
  const settled = paid.filter((r) => r.settlement === "settled" && r.tx_hash);
  const sum = (rs: Receipt[]) => Math.round(rs.reduce((a, r) => a + (r.fee_usd ?? 0), 0) * 1e6) / 1e6;
  const all = local;
  const allPaid = all.filter((r) => (r.fee_usd ?? 0) > 0);
  const allSettled = allPaid.filter((r) => r.settlement === "settled" && r.tx_hash);
  const everSettled = (ledger as Receipt[]).filter((r) => (r.fee_usd ?? 0) > 0 && r.settlement === "settled" && r.tx_hash);
  const h = store?.head;
  const lifetime = store
    ? {
        source: `durable receipt store github.com/${store.repo}`,
        since: h?.started_at ?? (all[0]?.checked_at ?? null),
        receipts: (h?.count ?? 0) + all.length,
        paid_checks: (h?.paid ?? 0) + allPaid.length,
        settled_checks: (h?.settled ?? 0) + allSettled.length,
        usd_settled: Math.round(((h?.usd_settled ?? 0) + sum(allSettled)) * 1e6) / 1e6,
        settled_tx: [...new Set(everSettled.map((r) => r.tx_hash!))].slice(-20),
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
    note: store
      ? "Counted from sealed receipts since counted_since: those read back from the durable receipt store at start plus those this process sealed (paid checks and free null-payee blocks), plus free previews. usd_settled_24h only counts receipts whose payment the facilitator settled; each names its tx_hash on Base."
      : "Counted from receipts this server process sealed since counted_since (paid checks and free null-payee blocks), plus free previews. usd_settled_24h only counts receipts whose payment the facilitator settled; each names its tx_hash on Base.",
  };
}
