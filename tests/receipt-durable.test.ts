/** Receipts that outlive the server: the paid answer carries its receipt, and payload verification says what it proves. */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { request, type Server } from "node:http";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { demoXPayment } from "../src/adapters/x402.js";
import { startServer } from "../src/api/server.js";
import { appendReceipt, importEntries, ledgerDurability, readEntries, readLedger, restoreFromMirror } from "../src/ledger/store.js";
import { decodeReceiptParam, encodeReceipt, encodeReceiptGz, MAX_RECEIPT_BYTES } from "../src/receipt-url.js";
import { exportLedger } from "../scripts/ledger-export.js";
import type { ReceiptBody } from "../src/core/receipt.js";
import { tmp } from "./helpers.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // EIP-55 example vector (dry-run only)
const FROM = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const PAID_URL = "https://api.weatherly.example/v1/forecast"; // offline fixture
let server: Server;
let base = "";
let dataDir = "";

const get = (path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; headers: Record<string, string>; text: string; body: any }>((ok, fail) => {
    const r = request(base + path, { headers }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let body: any = null;
        try {
          body = JSON.parse(b);
        } catch {
          /* html */
        }
        ok({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, text: b, body });
      });
    });
    r.on("error", fail);
    r.end();
  });

const body = (i: number): ReceiptBody => ({
  payee: "0x" + String(i).padStart(40, "1"),
  url: `https://seller${i}.example/paid`,
  terms_hash: "a".repeat(64),
  price: 0.01,
  band: "REVIEW",
  score: 60 + i,
  vow_fired: null,
  evidence: [],
  model: { verdict: "REVIEW", extractor: "none", degraded: false },
  snapshot_id: "b".repeat(64),
  checked_at: "2026-11-13T12:00:00.000Z",
  settlement: "dry-run",
});

async function paidCheck() {
  const u = `/v1/check?url=${encodeURIComponent(PAID_URL)}`;
  const r402 = await get(u);
  return get(u, { "x-payment": demoXPayment(r402.body.accepts[0], FROM) });
}

beforeAll(async () => {
  dataDir = tmp();
  Object.assign(process.env, { FIANGSHI_PAYTO: PAYTO, FIANGSHI_DATA_DIR: dataDir });
  delete process.env.FIANGSHI_LEDGER_MIRROR;
  server = await startServer(0, "127.0.0.1");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 30_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  delete process.env.FIANGSHI_LEDGER_MIRROR;
});

describe("the paid answer carries its own receipt", () => {
  it("receipt, receipt_id and receipt_verify_url agree, and X-RECEIPT-VERIFY repeats the URL", async () => {
    const r = await paidCheck();
    expect(r.status).toBe(200);
    expect(r.body.receipt.receipt_hash).toBe(r.body.receipt_id);
    expect(r.body.receipt_verify_url).toBe(`${base}/v1/verify?receipt=${encodeReceipt(r.body.receipt)}`);
    expect(r.headers["x-receipt-verify"]).toBe(r.body.receipt_verify_url);
    expect(r.body.settlement).toBe("dry-run");
    // byte-identical to what /v1/receipt/:id returns
    const stored = await get(`/v1/receipt/${r.body.receipt_id}`);
    expect(JSON.stringify(stored.body.receipt)).toBe(JSON.stringify(r.body.receipt));
    const v = await get(r.body.receipt_verify_url.slice(base.length));
    expect(v.body).toMatchObject({ valid: true, band_matches: true, source: "payload" });
  });
});

describe("payload verification says what it can and cannot prove", () => {
  it("for a receipt still in the ledger, payload and id answers are identical except source", async () => {
    const r = await paidCheck();
    const byId = (await get(`/v1/verify?id=${r.body.receipt_id}`)).body;
    const byPayload = (await get(`/v1/verify?receipt=${encodeReceipt(r.body.receipt)}`)).body;
    expect(byId.source).toBe("id");
    expect(byPayload.source).toBe("payload");
    expect({ ...byPayload, source: "x" }).toEqual({ ...byId, source: "x" });
    expect(byId.chain_linkage).toBe("verified");
  });
  it("chain_linkage is verified only when this server's ledger holds the link", async () => {
    const elsewhere = appendReceipt(body(1), join(tmp(), "ledger.jsonl"));
    const v = (await get(`/v1/verify?receipt=${encodeReceipt(elsewhere)}`)).body;
    expect(v.valid).toBe(true);
    expect(v.chain_linkage).toBe("unverified");
    expect(v.continuity).toContain("cannot be checked because the ledger that held it is not on this server");
    expect(v.continuity).not.toMatch(/^Continuous/);
    const census = (await get("/v1/index.json")).body.payees[0].receipt_id;
    expect((await get(`/v1/verify?id=${census}`)).body.chain_linkage).toBe("verified");
  });
  it("an unknown id answers 404 with the hint to send the payload", async () => {
    const r = await get(`/v1/verify?id=${"e".repeat(64)}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("unknown receipt id: the live ledger resets on redeploy");
    expect(r.body.hint).toBe("if you kept the receipt, verify it with ?receipt=<base64url JSON>");
  });
  it("the gz: form round-trips; more than 16 KB is refused", async () => {
    const rc = appendReceipt(body(2), join(tmp(), "ledger.jsonl"));
    const gz = encodeReceiptGz(rc);
    expect(gz.startsWith("gz:")).toBe(true);
    const d = decodeReceiptParam(gz);
    expect(d.ok && (d.obj as { receipt_hash: string }).receipt_hash).toBe(rc.receipt_hash);
    expect((await get(`/v1/verify?receipt=${gz}`)).body.valid).toBe(true);
    const big = { ...rc, padding: "x".repeat(MAX_RECEIPT_BYTES) };
    expect(decodeReceiptParam(encodeReceipt(big))).toEqual({ ok: false, error: `receipt is larger than ${MAX_RECEIPT_BYTES} bytes` });
    expect(decodeReceiptParam(encodeReceiptGz(big))).toEqual({ ok: false, error: `receipt is larger than ${MAX_RECEIPT_BYTES} bytes` });
    expect((await get(`/v1/verify?receipt=${encodeReceiptGz(big)}`)).status).toBe(413);
  });
});

describe("the live ledger can survive", () => {
  it("export then import restores every id; a tampered prev_hash is refused and counted", () => {
    const from = join(tmp(), "ledger.jsonl");
    const ids = [1, 2, 3].map((i) => appendReceipt(body(i), from).receipt_hash);
    const out = exportLedger(from, join(tmp(), "ledger-export.jsonl"));
    expect(out.entries).toBe(3);
    const to = join(tmp(), "ledger.jsonl");
    const r = importEntries(readEntries(out.path), to);
    expect(r).toMatchObject({ accepted: 3, refused: 0 });
    expect((readLedger(to) as { receipt_hash: string }[]).map((x) => x.receipt_hash)).toEqual(ids);
    // the same file again: nothing rewritten, nothing refused
    expect(importEntries(readEntries(out.path), to)).toMatchObject({ accepted: 0, present: 3, refused: 0 });
    // a tampered prev_hash (hash recomputed or not) never links
    const lines = readFileSync(out.path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    lines[1].prev_hash = "f".repeat(64);
    const bad = join(tmp(), "bad.jsonl");
    writeFileSync(bad, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const r2 = importEntries(readEntries(bad), join(tmp(), "ledger.jsonl"));
    expect(r2.accepted).toBe(1);
    expect(r2.refused).toBe(2); // the tampered entry, and the one after it, which now links to nothing
  });
  it("a mirror receives every appended line and restores the chain on start", () => {
    const mirror = tmp();
    process.env.FIANGSHI_LEDGER_MIRROR = mirror;
    const live = join(tmp(), "ledger.jsonl");
    const ids = [4, 5].map((i) => appendReceipt(body(i), live).receipt_hash);
    expect(readdirSync(mirror).filter((f) => /^ledger-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))).toHaveLength(1);
    const fresh = join(tmp(), "ledger.jsonl"); // a wiped disk
    expect(restoreFromMirror(fresh)).toEqual({ entries: 2, intact: 2, refused: 0 });
    expect((readLedger(fresh) as { receipt_hash: string }[]).map((x) => x.receipt_hash)).toEqual(ids);
    // a receipt appended after the restore continues the same chain
    const next = appendReceipt(body(6), fresh);
    expect(next.prev_hash).toBe(ids[1]);
  });
  it("/health says ephemeral without a mirror and durable with one", async () => {
    expect((await get("/health")).body.ledger_durability).toBe("ephemeral: receipts are verifiable from their payload, not by id");
    const mirror = tmp();
    process.env.FIANGSHI_LEDGER_MIRROR = mirror;
    expect(ledgerDurability(join(dataDir, "ledger.jsonl"))).toMatch(new RegExp(`^durable: ${mirror.replace(/\\/g, "\\\\")}, \\d+ entries$`));
    expect((await get("/health")).body.ledger_durability).toMatch(/^durable: .+, \d+ entries$/);
  });
});

describe("the check page shows the durable part", () => {
  it("a census payee's check page has the receipt id, the verify URL as text, and no script", async () => {
    const r = await get(`/check?url=${encodeURIComponent("https://api.bitrefill.com/x402/gift-cards/search")}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain("Keep this receipt");
    expect(r.text).toMatch(/<textarea class="vurl" readonly[^>]*>http:\/\/127\.0\.0\.1:\d+\/v1\/verify\?receipt=[A-Za-z0-9_-]+<\/textarea>/);
    expect(r.text).toContain("Verify without our server: paste this URL in a browser; you do not need our ledger.");
    expect(r.text).not.toMatch(/<script/i);
    expect(r.text).not.toMatch(/\son[a-z]+=/i);
  });
});
