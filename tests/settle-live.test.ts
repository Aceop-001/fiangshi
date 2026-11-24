/**
 * Task 2 (2026-11-24): live settlement through the CDP x402 facilitator, behind FIANGSHI_SETTLE=live. The facilitator
 * is stubbed at the HTTP boundary (its documented verify/settle bodies and answers); everything else runs for real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { request, type Server } from "node:http";
import { createPublicKey, generateKeyPairSync, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { demoXPayment } from "../src/adapters/x402.js";
import { cdpJwt, setFacilitatorFetch } from "../src/adapters/facilitator.js";
import { startServer } from "../src/api/server.js";
import { ledgerPath } from "../src/ledger/store.js";
import { tmp } from "./helpers.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const FROM = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const PAID_URL = "https://api.weatherly.example/v1/forecast"; // offline fixture
const TX = "0x" + "ab".repeat(32);

// an Ed25519 CDP-style key: secret = base64(32-byte seed || 32-byte public key)
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
const spki = publicKey.export({ format: "der", type: "spki" });
const SECRET = Buffer.concat([pkcs8.subarray(pkcs8.length - 32), spki.subarray(spki.length - 32)]).toString("base64");
const KEY_ID = "11111111-2222-3333-4444-555555555555";

type Call = { url: string; auth: string; body: any };
let calls: Call[] = [];
let verifyAnswer: any = { isValid: true, payer: FROM };
let settleAnswer: any = { success: true, transaction: TX, network: "eip155:8453", payer: FROM };
const stub = (async (u: string | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "null"));
  calls.push({ url: String(u), auth: new Headers(init?.headers).get("Authorization") ?? "", body });
  const op = String(u).endsWith("/verify") ? verifyAnswer : settleAnswer;
  return new Response(JSON.stringify(op), { status: op.isValid === false || op.success === false ? 400 : 200 });
}) as typeof fetch;

let server: Server;
let base = "";
const get = (path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; headers: Record<string, string>; body: any }>((ok, fail) => {
    const r = request(base + path, { headers }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, body: JSON.parse(b) }));
    });
    r.on("error", fail);
    r.end();
  });
/** the x402 v2 PaymentPayload a client sends in PAYMENT-SIGNATURE: the chosen terms in `accepted`, the EIP-3009 payload */
const v2Payment = (req: any) => {
  const old = JSON.parse(Buffer.from(demoXPayment(req, FROM), "base64").toString());
  return Buffer.from(JSON.stringify({ x402Version: 2, accepted: req, payload: old.payload })).toString("base64");
};
const ledgerLines = () => {
  try {
    return readFileSync(ledgerPath(), "utf8").split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
};
const paid = async () => {
  const u = `/v1/check?url=${encodeURIComponent(PAID_URL)}`;
  const r402 = await get(u);
  return { r402, r: await get(u, { "payment-signature": v2Payment(r402.body.accepts[0]) }) };
};

const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_PAYTO: PAYTO, FIANGSHI_DATA_DIR: tmp(), FIANGSHI_SETTLE: "live", CDP_API_KEY_ID: KEY_ID, CDP_API_KEY_SECRET: SECRET });
  setFacilitatorFetch(stub);
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
  calls = [];
  verifyAnswer = { isValid: true, payer: FROM };
  settleAnswer = { success: true, transaction: TX, network: "eip155:8453", payer: FROM };
  Object.assign(process.env, { FIANGSHI_SETTLE: "live", CDP_API_KEY_ID: KEY_ID, CDP_API_KEY_SECRET: SECRET });
});

describe("CDP JWT", () => {
  it("is EdDSA-signed with the documented header and claims, and verifies with the key's public half", () => {
    const jwt = cdpJwt("POST", "/platform/v2/x402/settle", 1_800_000_000, KEY_ID, SECRET);
    const [h, p, sig] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(header).toMatchObject({ alg: "EdDSA", typ: "JWT", kid: KEY_ID });
    expect(header.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(claims).toEqual({ sub: KEY_ID, iss: "cdp", aud: ["cdp_service"], nbf: 1_800_000_000, exp: 1_800_000_120, uri: "POST api.cdp.coinbase.com/platform/v2/x402/settle" });
    expect(edVerify(null, Buffer.from(`${h}.${p}`), createPublicKey(publicKey.export({ format: "pem", type: "spki" })), Buffer.from(sig!, "base64url"))).toBe(true);
  });
});

describe("FIANGSHI_SETTLE=live", () => {
  it("a v2 PAYMENT-SIGNATURE is verified, the check runs, the payment settles, and the receipt says so", async () => {
    const { r402, r } = await paid();
    expect(r.status).toBe(200);
    expect([r.body.settlement, r.body.tx_hash]).toEqual(["settled", TX]);
    expect(r.body.receipt).toMatchObject({ settlement: "settled", tx_hash: TX, chain: "eip155:8453", price: expect.any(Number) });
    const pr = JSON.parse(Buffer.from(r.headers["payment-response"]!, "base64").toString());
    expect(pr).toMatchObject({ success: true, transaction: TX, network: "eip155:8453" });
    // the facilitator got the documented body: x402Version 2, the client's payment unchanged, the 402's own terms
    expect(calls.map((c) => c.url)).toEqual(["https://api.cdp.coinbase.com/platform/v2/x402/verify", "https://api.cdp.coinbase.com/platform/v2/x402/settle"]);
    expect(calls[1]!.body.x402Version).toBe(2);
    expect(calls[1]!.body.paymentRequirements).toEqual(r402.body.accepts[0]);
    expect(calls[1]!.body.paymentPayload.accepted).toEqual(r402.body.accepts[0]);
    expect(calls[1]!.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    // and the settled receipt still verifies by id
    const v = await get(`/v1/verify?id=${r.body.receipt_id}`);
    expect([v.body.valid, v.body.chain_linkage]).toEqual([true, "verified"]);
  });
  it("a payment the facilitator rejects is a 402 with its reason: no work, no settlement, no receipt", async () => {
    verifyAnswer = { isValid: false, invalidReason: "insufficient_funds", invalidMessage: "Insufficient funds", payer: FROM };
    const before = ledgerLines();
    const { r } = await paid();
    expect(r.status).toBe(402);
    expect(r.body.error).toMatch(/insufficient_funds/);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["verify"]);
    expect(ledgerLines()).toBe(before);
  });
  it("a settlement that fails delivers nothing and seals no receipt", async () => {
    settleAnswer = { success: false, errorReason: "insufficient_funds", transaction: "", network: "eip155:8453", payer: FROM };
    const before = ledgerLines();
    const { r } = await paid();
    expect(r.status).toBe(402);
    expect(r.body.band).toBeUndefined();
    expect(JSON.parse(Buffer.from(r.headers["payment-response"]!, "base64").toString())).toMatchObject({ success: false, errorReason: "insufficient_funds" });
    expect(ledgerLines()).toBe(before);
  });
  it("live without CDP keys refuses with 503 instead of pretending", async () => {
    delete process.env.CDP_API_KEY_SECRET;
    const { r } = await paid();
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/CDP_API_KEY/);
    expect(calls).toEqual([]);
  });
  it("dry-run (the default) never contacts the facilitator and says dry-run", async () => {
    process.env.FIANGSHI_SETTLE = "";
    const { r } = await paid();
    expect([r.status, r.body.settlement, r.body.receipt.settlement, r.body.tx_hash]).toEqual([200, "dry-run", "dry-run", undefined]);
    expect(calls).toEqual([]);
  });
});
