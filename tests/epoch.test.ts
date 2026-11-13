import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { request, type Server } from "node:http";
import { appendReceipt, currentEpoch, readLedger } from "../src/ledger/store.js";
import { verifyReceipt } from "../src/core/receipt.js";
import { startServer } from "../src/api/server.js";
import type { Receipt } from "../src/core/types.js";
import { tmp } from "./helpers.js";

const body = (n: number) => ({
  payee: "0x" + "a".repeat(40),
  url: `https://seller.example/${n}`,
  terms_hash: "b".repeat(64),
  price: 0.01,
  band: "REVIEW" as const,
  score: 60,
  vow_fired: null,
  evidence: [],
  model: { verdict: null, extractor: "none", degraded: true },
  snapshot_id: "c".repeat(64),
  checked_at: "2026-11-13T00:00:00.000Z",
  settlement: "dry-run" as const,
});

describe("ledger epochs (the chain does not pretend to survive a redeploy)", () => {
  it("every live receipt carries the epoch's chain_id, and it is covered by the hash", () => {
    const path = join(tmp(), "ledger.jsonl");
    const a = appendReceipt(body(1), path);
    const b = appendReceipt(body(2), path);
    expect(a.chain_id).toMatch(/^[0-9a-f]{64}$/);
    expect(b.chain_id).toBe(a.chain_id);
    expect(b.prev_hash).toBe(a.receipt_hash);
    expect(verifyReceipt({ ...a, chain_id: "d".repeat(64) }).ok).toBe(false);
  });
  it("a wiped ledger (a redeploy on ephemeral disk) starts a new epoch with a new chain_id and a fresh genesis", () => {
    const dir = tmp();
    const path = join(dir, "ledger.jsonl");
    const first = appendReceipt(body(1), path);
    rmSync(path);
    const second = appendReceipt(body(2), path);
    expect(second.chain_id).not.toBe(first.chain_id);
    expect(second.prev_hash).toBe("genesis");
    expect(readLedger(path)).toHaveLength(1);
    expect(currentEpoch(path).durability).toBe("resets on redeploy");
  });
});

describe("GET /v1/verify reports the epoch honestly", () => {
  let server: Server;
  let base = "";
  let dir = "";
  const get = (p: string) =>
    new Promise<any>((ok, fail) => {
      const r = request(base + p, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => ok(JSON.parse(b)));
      });
      r.on("error", fail);
      r.end();
    });
  beforeAll(async () => {
    dir = tmp();
    Object.assign(process.env, { FIANGSHI_DATA_DIR: dir });
    server = await startServer(0, "127.0.0.1");
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 30_000);
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("a receipt in the current epoch: chain position, chain_id, start time and the reset caveat", async () => {
    const r = appendReceipt(body(1), join(dir, "ledger.jsonl"));
    const v = await get(`/v1/verify?id=${r.receipt_hash}`);
    expect(v.valid).toBe(true);
    expect(v.chain).toBe("ledger #0");
    expect(v.chain_id).toBe(r.chain_id);
    expect(v.continuity).toContain("resets when it is redeployed");
  });
  it("a receipt from an earlier epoch: still valid, but says its continuity cannot be checked here", async () => {
    const old: Receipt = appendReceipt(body(9), join(tmp(), "ledger.jsonl"));
    const enc = Buffer.from(JSON.stringify(old)).toString("base64url");
    const v = await get(`/v1/verify?receipt=${enc}`);
    expect(v.valid).toBe(true);
    expect(v.chain).toBe("an earlier ledger epoch (hash self-consistent)");
    expect(v.continuity).toContain("cannot be checked here");
  });
});
