/**
 * Task 5 (2026-11-24): the keyless revenue path. /v1/batch checks up to ten endpoints under one x402 payment at 20% off;
 * /v1/stats counts checks served and USD settled from sealed receipts. No keys, no stored balances.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { request, type Server } from "node:http";
import { demoXPayment } from "../src/adapters/x402.js";
import { setFacilitatorFetch } from "../src/adapters/facilitator.js";
import { startServer } from "../src/api/server.js";
import { generateKeyPairSync } from "node:crypto";
import { tmp } from "./helpers.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const FROM = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const A = "https://api.weatherly.example/v1/forecast";
const B = "https://api.lexicon.example/v1/define";
const NULL_PAYEE = "https://api.cleave.fi/x402/gas";
const TX = "0x" + "cd".repeat(32);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pk = privateKey.export({ format: "der", type: "pkcs8" });
const pub = publicKey.export({ format: "der", type: "spki" });
const SECRET = Buffer.concat([pk.subarray(pk.length - 32), pub.subarray(pub.length - 32)]).toString("base64");
let facilitatorCalls = 0;
setFacilitatorFetch((async (u: string | URL) => {
  facilitatorCalls++;
  return new Response(JSON.stringify(String(u).endsWith("/verify") ? { isValid: true, payer: FROM } : { success: true, transaction: TX, network: "eip155:8453", payer: FROM }), { status: 200 });
}) as typeof fetch);

let server: Server;
let base = "";
const get = (path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: any }>((ok, fail) => {
    const r = request(base + path, { headers }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: JSON.parse(b) }));
    });
    r.on("error", fail);
    r.end();
  });
const batchPath = (...urls: string[]) => `/v1/batch?${urls.map((x) => `url=${encodeURIComponent(x)}`).join("&")}`;
const payFor = (r402: any) => {
  const req = r402.accepts[0];
  const old = JSON.parse(Buffer.from(demoXPayment(req, FROM), "base64").toString());
  return Buffer.from(JSON.stringify({ x402Version: 2, accepted: req, payload: old.payload })).toString("base64");
};

const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_PAYTO: PAYTO, FIANGSHI_DATA_DIR: tmp(), CDP_API_KEY_ID: "k", CDP_API_KEY_SECRET: SECRET });
  delete process.env.FIANGSHI_SETTLE;
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 60_000);
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  for (const k of ["FIANGSHI_SETTLE", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET"]) delete process.env[k];
  Object.assign(process.env, saved);
});
beforeEach(() => {
  facilitatorCalls = 0;
  delete process.env.FIANGSHI_SETTLE;
});

describe("/v1/batch", () => {
  it("asks one price for the batch: the paid checks' sum, 20% off; a null payee is not charged", async () => {
    const r = await get(batchPath(A, B, NULL_PAYEE));
    expect(r.status).toBe(402);
    expect(r.body.accepts[0].amount).toBe("80000"); // (0.05 + 0.05) * 0.8 = $0.08, the null payee free
  });
  it("one payment, every check answered with its own receipt and fee; the null payee answered free", async () => {
    const path = batchPath(A, B, NULL_PAYEE);
    const r402 = (await get(path)).body;
    const r = await get(path, { "payment-signature": payFor(r402) });
    expect(r.status).toBe(200);
    expect([r.body.count, r.body.list_price_usd, r.body.cost_usd, r.body.discount, r.body.settlement]).toEqual([3, 0.1, 0.08, 0.2, "dry-run"]);
    const [a, b, n] = r.body.items;
    expect([a.url, b.url, n.url]).toEqual([A, B, NULL_PAYEE]);
    for (const x of [a, b]) expect([x.receipt.fee_usd, x.receipt.settlement, typeof x.receipt_id]).toEqual([0.04, "dry-run", "string"]);
    expect([n.band, n.cost_usd]).toEqual(["BLOCK", 0]);
    expect(facilitatorCalls).toBe(0);
  });
  it("live: one verify, one settle, and every paid receipt names the same settlement tx", async () => {
    process.env.FIANGSHI_SETTLE = "live";
    const path = batchPath(A, B);
    const r = await get(path, { "payment-signature": payFor((await get(path)).body) });
    expect([r.status, r.body.settlement, r.body.tx_hash]).toEqual([200, "settled", TX]);
    expect(r.body.items.map((x: any) => [x.receipt.settlement, x.receipt.tx_hash, x.receipt.fee_usd])).toEqual([["settled", TX, 0.04], ["settled", TX, 0.04]]);
    expect(facilitatorCalls).toBe(2);
  });
  it("refuses more than ten, duplicates, and non-http urls", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `https://x${i}.example/p`);
    for (const p of [batchPath(...eleven), batchPath(A, A), batchPath("ftp://x.example"), "/v1/batch"]) expect((await get(p)).status).toBe(400);
  });
});

describe("/v1/stats", () => {
  it("counts from sealed receipts: only settled payments count as USD settled, each with its tx", async () => {
    const s = (await get("/v1/stats")).body;
    expect(s.settled_checks_24h).toBe(2);
    expect(s.usd_settled_24h).toBe(0.08);
    expect(s.settled_tx).toEqual([TX]);
    expect(s.paid_checks_24h).toBe(4); // two dry-run batch checks and two settled
    expect(s.usd_charged_dry_run_24h).toBe(0.08);
    expect(s.checks_served_24h).toBeGreaterThanOrEqual(5); // plus the free null-payee blocks
    expect(s.window_hours).toBe(24);
  });
  it("free previews are counted too", async () => {
    const before = (await get("/v1/stats")).body.free_previews_24h;
    await get(`/v1/preview?url=${encodeURIComponent(A)}`);
    expect((await get("/v1/stats")).body.free_previews_24h).toBe(before + 1);
  });
});
