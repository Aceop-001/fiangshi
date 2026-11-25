/**
 * 2026-11-25: a restart emptied /v1/stats' 24 h window (settled_checks_24h 0, settled_tx []) while `lifetime` said
 * 1 settled check, because the window counted only this process's receipts. With the receipt store, the receipts read
 * back from it count too, each once, and the window is the real last 24 h.
 */
import { describe, it, expect } from "vitest";
import { usageStats } from "../src/stats.js";
import type { Receipt } from "../src/core/types.js";

const TX = "0x" + "90".repeat(32);
const NOW = Date.parse("2026-11-25T05:00:00Z");
const r = (id: string, at: string, extra: Partial<Receipt> = {}): Receipt =>
  ({ receipt_hash: id.padEnd(64, "0"), checked_at: at, settlement: "dry-run", ...extra }) as Receipt;
const settled = r("682a", "2026-11-25T04:15:27Z", { settlement: "settled", tx_hash: TX, fee_usd: 0.05 });
const dry = r("3416", "2026-11-25T03:50:17Z", { fee_usd: 0.05 });
const head = { receipt_hash: settled.receipt_hash, chain_id: null, started_at: "2026-11-25T03:50:17Z", count: 2, paid: 2, settled: 1, usd_settled: 0.05 };

describe("/v1/stats after a restart, with the receipt store", () => {
  it("the payment sealed before the restart still counts in the 24 h window, with its tx", () => {
    const s = usageStats([], NOW, "live", { head, repo: "o/r", history: [settled, dry] });
    expect([s.checks_served_24h, s.paid_checks_24h, s.settled_checks_24h, s.usd_settled_24h]).toEqual([2, 2, 1, 0.05]);
    expect(s.settled_tx).toEqual([TX]);
    expect(s.counted_since).toBe(new Date(NOW - 24 * 3_600_000).toISOString());
    expect(s.lifetime).toMatchObject({ receipts: 2, settled_checks: 1, usd_settled: 0.05, settled_tx: [TX] });
  });
  it("a receipt both read back and in the local ledger counts once; older than 24 h falls out of the window", () => {
    const old = r("0ld0", "2026-11-23T01:00:00Z", { fee_usd: 0.05 });
    const s = usageStats([settled], NOW, "live", { head, repo: "o/r", history: [settled, dry, old] });
    expect([s.checks_served_24h, s.settled_checks_24h, s.usd_settled_24h]).toEqual([2, 1, 0.05]);
  });
  it("without a store, nothing changes: the window starts at this process", () => {
    const s = usageStats([], NOW, "dry-run", null);
    expect([s.checks_served_24h, s.settled_tx]).toEqual([0, []]);
    expect(Date.parse(s.counted_since)).toBeGreaterThan(NOW - 24 * 3_600_000);
  });
});
