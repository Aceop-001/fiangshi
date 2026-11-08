import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { sealReceipt, verifyChain, verifyReceipt, type ReceiptBody } from "../src/core/receipt.js";
import { appendReceipt, readLedger } from "../src/ledger/store.js";
import { tmp } from "./helpers.js";

const H = "a".repeat(64);
const body: ReceiptBody = {
  payee: "0xp",
  url: "https://x.example",
  terms_hash: H,
  price: 0.05,
  band: "ALLOW",
  score: 92.75,
  vow_fired: null,
  evidence: [{ signal: "tx_count", quote: "800 tx" }],
  model: { verdict: "ALLOW", extractor: "fixture-identity", degraded: false },
  snapshot_id: H,
  checked_at: "2026-11-08T00:00:00.000Z",
  settlement: "dry-run",
};

describe("receipt", () => {
  it("sealed receipt verifies", () => expect(verifyReceipt(sealReceipt(body, "genesis")).ok).toBe(true));

  it("tampering ANY field breaks verify", () => {
    const r = sealReceipt(body, "genesis") as unknown as Record<string, unknown>;
    const tampered: Record<string, unknown> = {
      payee: "0xq", url: "https://y.example", terms_hash: "b".repeat(64), price: 0.01, band: "BLOCK", score: 10,
      vow_fired: "age", evidence: [], model: { verdict: "BLOCK", extractor: "x", degraded: true }, snapshot_id: "c".repeat(64),
      checked_at: "2030-01-01T00:00:00.000Z", prev_hash: "d".repeat(64), settlement: "kite:0xabc",
    };
    for (const [k, v] of Object.entries(tampered)) expect(verifyReceipt({ ...r, [k]: v }).ok, k).toBe(false);
    expect(verifyReceipt({ ...r, extra: 1 }).ok).toBe(false);
  });

  it("ledger chain verifies and detects a removed middle receipt", () => {
    const path = join(tmp(), "ledger.jsonl");
    for (let i = 0; i < 3; i++) appendReceipt({ ...body, score: i }, path);
    const all = readLedger(path);
    expect(verifyChain(all).ok).toBe(true);
    expect(verifyChain([all[0], all[2]]).ok).toBe(false);
  });
});
