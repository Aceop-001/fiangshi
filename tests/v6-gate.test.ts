/** V6 is enforced at probe time: a null/sink payTo is BLOCKed with a sealed $0.00 receipt and ZERO paid calls. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = vi.hoisted(() => ({ guarded: 0, snapshot: 0, serv: 0, dolphin: 0 }));
const probeReply = vi.hoisted(() => ({ payTo: "0x0000000000000000000000000000000000000000", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }));

vi.mock("../scripts/budget.js", async (orig) => {
  const m = await orig<typeof import("../scripts/budget.js")>();
  return { ...m, guarded: vi.fn(async (...a: Parameters<typeof m.guarded>) => (calls.guarded++, m.guarded(...a))) };
});
vi.mock("../src/snapshot.js", async (orig) => {
  const m = await orig<typeof import("../src/snapshot.js")>();
  return { ...m, getSnapshot: vi.fn(async () => (calls.snapshot++, m.getSnapshot())) };
});
vi.mock("../src/adapters/serv.js", async (orig) => {
  const m = await orig<typeof import("../src/adapters/serv.js")>();
  return { ...m, adjudicate: vi.fn(async (...a: Parameters<typeof m.adjudicate>) => (calls.serv++, m.adjudicate(...a))) };
});
vi.mock("../src/adapters/dolphin.js", async (orig) => {
  const m = await orig<typeof import("../src/adapters/dolphin.js")>();
  return { ...m, extractIdentity: vi.fn(async (...a: Parameters<typeof m.extractIdentity>) => (calls.dolphin++, m.extractIdentity(...a))) };
});
vi.mock("../src/adapters/probe.js", async (orig) => {
  const m = await orig<typeof import("../src/adapters/probe.js")>();
  return {
    ...m,
    // the shape of the real api.cleave.fi/x402/gas 402 (2026-11-09): $5 USDC to the zero address
    probe: vi.fn(async (url: string) =>
      m.parse402({
        url,
        status: 402,
        headers: {},
        body: { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "5000000", asset: probeReply.asset, payTo: probeReply.payTo, maxTimeoutSeconds: 60 }] },
      }),
    ),
  };
});

import { check } from "../src/check.js";
import { verifyReceipt } from "../src/core/receipt.js";

beforeEach(() => Object.assign(calls, { guarded: 0, snapshot: 0, serv: 0, dolphin: 0 }));

describe("V6 probe-time gate", () => {
  it("zero-address payTo -> BLOCK (null_payee), $0.00: zero Surf/SERV/Dolphin calls, no snapshot load", async () => {
    probeReply.payTo = "0x0000000000000000000000000000000000000000";
    const r = await check("https://api.cleave.fi/x402/gas", { ledger: false });
    expect(r.decision.verdict).toMatchObject({ band: "BLOCK", vow_fired: "null_payee" });
    expect(r.terms?.price).toBe(5);
    expect(calls).toEqual({ guarded: 0, snapshot: 0, serv: 0, dolphin: 0 });
    expect(verifyReceipt(r.receipt).ok).toBe(true);
    expect(r.receipt).toMatchObject({ band: "BLOCK", vow_fired: "null_payee", model: { verdict: null, extractor: "none", degraded: false } });
  });

  it("payTo == the payment-asset contract -> BLOCK at probe time, zero paid calls", async () => {
    probeReply.payTo = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const r = await check("https://x.example/pay", { ledger: false });
    expect(r.decision.verdict.vow_fired).toBe("null_payee");
    expect(r.decision.verdict.citations[0]!.quote).toMatch(/payto_is_asset/);
    expect(calls.guarded + calls.serv + calls.dolphin + calls.snapshot).toBe(0);
  });

  it("bad EIP-55 checksum -> BLOCK at probe time (raw case preserved through the probe)", async () => {
    probeReply.payTo = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD";
    const r = await check("https://x.example/pay", { ledger: false });
    expect(r.decision.verdict.citations[0]!.quote).toMatch(/bad_checksum/);
    expect(calls.guarded).toBe(0);
  });

  it("valid control: a correctly checksummed payee passes the gate and proceeds to the normal pipeline", async () => {
    probeReply.payTo = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    const r = await check("https://x.example/pay", { ledger: false });
    expect(r.decision.verdict.vow_fired).not.toBe("null_payee");
    expect(calls.snapshot).toBe(1); // went past the gate
  });
});
