/**
 * Task 3 (2026-11-24): receipts that survive a redeploy, on a GitHub repository. A fake GitHub implements the documented
 * contents API (PUT creates 201 / updates 200 with `sha`; GET returns raw bytes for the raw media type, JSON with `sha`
 * otherwise, 404 when missing), so the test plays a real redeploy: process 1 writes, its disk is wiped, process 2 reads
 * HEAD, continues the same chain, and serves the old receipts by id with their hash and link verified.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { startServer } from "../src/api/server.js";
import { appendReceipt, ledgerDurability, ledgerPath, restoreFromGithub, setRemoteHead } from "../src/ledger/store.js";
import { flushStore, receiptPath, setGithubFetch } from "../src/ledger/github.js";
import type { ReceiptBody } from "../src/core/receipt.js";
import { tmp } from "./helpers.js";

const files = new Map<string, { text: string; sha: number }>();
let writes = 0;
const fakeGithub = (async (input: string | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  const m = /^\/repos\/test\/receipts\/contents\/(.+)$/.exec(u.pathname);
  if (!m) return new Response("not found", { status: 404 });
  const path = decodeURIComponent(m[1]!);
  const h = new Headers(init?.headers);
  if (h.get("Authorization") !== "Bearer t") return new Response("bad credentials", { status: 401 });
  if ((init?.method ?? "GET") === "PUT") {
    const b = JSON.parse(String(init!.body)) as { message: string; content: string; sha?: string };
    const cur = files.get(path);
    if (cur && b.sha !== String(cur.sha)) return new Response("sha required", { status: 422 });
    writes++;
    files.set(path, { text: Buffer.from(b.content, "base64").toString("utf8"), sha: (cur?.sha ?? 0) + 1 });
    return new Response("{}", { status: cur ? 200 : 201 });
  }
  const f = files.get(path);
  if (!f) return new Response("not found", { status: 404 });
  return h.get("Accept") === "application/vnd.github.raw+json" ? new Response(f.text, { status: 200 }) : new Response(JSON.stringify({ sha: String(f.sha) }), { status: 200 });
}) as typeof fetch;

const body = (i: number): ReceiptBody => ({
  payee: "0x" + String(i).padStart(40, "1"),
  url: `https://seller${i}.example/paid`,
  terms_hash: "a".repeat(64),
  price: 0.05,
  band: "REVIEW",
  score: 60 + i,
  vow_fired: null,
  evidence: [],
  model: { verdict: "REVIEW", extractor: "none", degraded: false },
  snapshot_id: "b".repeat(64),
  checked_at: "2026-11-24T12:00:00.000Z",
  settlement: "dry-run",
});

let server: Server;
let base = "";
const getJson = (path: string) =>
  new Promise<{ status: number; body: any }>((ok, fail) => {
    const r = request(base + path, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: JSON.parse(b) }));
    });
    r.on("error", fail);
    r.end();
  });

const saved = { ...process.env };
let first: string, second: string, third: string;
let firstLine = "";

beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_RECEIPTS_REPO: "test/receipts", FIANGSHI_RECEIPTS_TOKEN: "t" });
  setGithubFetch(fakeGithub);
  // process 1: a fresh disk, an empty store
  process.env.FIANGSHI_DATA_DIR = tmp();
  setRemoteHead(null);
  first = appendReceipt(body(1)).receipt_hash;
  firstLine = readFileSync(ledgerPath(), "utf8").split(/\r?\n/)[0]!;
  second = appendReceipt(body(2)).receipt_hash;
  await flushStore();
  // redeploy: the disk is wiped, the store is not
  process.env.FIANGSHI_DATA_DIR = tmp();
  setRemoteHead(null);
  server = await startServer(0, "127.0.0.1"); // reads HEAD before serving
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  third = appendReceipt(body(3)).receipt_hash;
  await flushStore();
}, 60_000);
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  setRemoteHead(null);
  for (const k of ["FIANGSHI_RECEIPTS_REPO", "FIANGSHI_RECEIPTS_TOKEN"]) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("durable receipts on a GitHub repository", () => {
  it("each receipt is stored once, byte-identical to its ledger line, and HEAD names the newest", () => {
    expect(files.get(receiptPath(first))!.text).toBe(firstLine + "\n");
    const head = JSON.parse(files.get("receipts/HEAD.json")!.text);
    expect(head).toMatchObject({ receipt_hash: third, count: 3 });
  });
  it("after a redeploy the chain continues: the new receipt links to the stored HEAD, same chain_id", async () => {
    const r3 = (await getJson(`/v1/receipts/${third}`)).body;
    const r1 = (await getJson(`/v1/receipts/${first}`)).body;
    expect(r3.receipt.prev_hash).toBe(second);
    expect(r3.receipt.chain_id).toBe(r1.receipt.chain_id);
    expect([r3.source, r3.verify.valid, r3.verify.chain_linkage]).toEqual(["ledger", true, "verified"]);
  });
  it("a receipt from before the redeploy is served from the store, re-hashed, with its link checked there", async () => {
    for (const id of [first, second]) {
      const r = await getJson(`/v1/receipts/${id}`);
      expect(r.status).toBe(200);
      expect([r.body.source, r.body.verify.valid, r.body.verify.chain_linkage, r.body.verify.errors]).toEqual(["store", true, "verified", []]);
      expect(r.body.verify.chain).toBe("receipt store github.com/test/receipts");
    }
    expect((await getJson(`/v1/verify?id=${first}`)).body.valid).toBe(true);
    expect((await getJson(`/v1/receipt/${second}`)).body.chain).toBe("store");
  });
  it("a tampered stored receipt fails verification", async () => {
    const p = receiptPath(second);
    const orig = files.get(p)!;
    files.set(p, { ...orig, text: orig.text.replace('"score":62', '"score":99') });
    const r = await getJson(`/v1/receipts/${second}`);
    expect(r.body.verify.valid).toBe(false);
    files.set(p, orig);
  });
  it("lifetime totals survive the redeploy: the store's HEAD plus this process", async () => {
    const st = (await getJson("/v1/stats")).body;
    expect(st.lifetime).toMatchObject({ source: "durable receipt store github.com/test/receipts", receipts: 3, paid_checks: 0, settled_checks: 0, usd_settled: 0 });
    // the restarted process read receipts 1 and 2 back from the store: the 24 h window holds all three, not just its own
    expect(st.checks_served_24h).toBe(3);
    const h = (await getJson("/health")).body;
    expect(h.receipts_stored.store_total).toBe(3);
    expect(JSON.parse(files.get("receipts/HEAD.json")!.text)).toMatchObject({ count: 3, paid: 0, settled: 0, usd_settled: 0 });
  });
  it("an unknown id is a 404; /health says the ledger is durable", async () => {
    expect((await getJson(`/v1/receipts/${"f".repeat(64)}`)).status).toBe(404);
    expect(ledgerDurability()).toMatch(/^durable: receipts committed to github\.com\/test\/receipts/);
  });
  it("writes went one at a time and nothing was rewritten: 3 receipts + 3 HEAD updates", () => {
    expect(writes).toBe(6);
  });
});
