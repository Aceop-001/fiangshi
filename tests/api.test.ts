/** API surface against a real server on 127.0.0.1 (offline mode: probes replay fixtures, models are mocked). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request } from "node:http";
import type { Server } from "node:http";
import { parse402 } from "../src/adapters/probe.js";
import { demoXPayment, paymentRequired, verifyXPayment } from "../src/adapters/x402.js";
import { startServer } from "../src/api/server.js";
import { modelCalls } from "../src/adapters/serv.js";
import { tmp } from "./helpers.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // EIP-55 example vector (dry-run demo only)
const FROM = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
let server: Server;
let base = "";

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request(base + path, { method: "GET", headers }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, body: b }));
    });
    r.on("error", reject);
    r.end();
  });
}

beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_PAYTO: PAYTO, FIANGSHI_DATA_DIR: tmp() });
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 30_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("x402 seller side", () => {
  it("the 402 body Fiangshi emits parses with Fiangshi's own probe parser", () => {
    const pr = paymentRequired("https://x/v1/check", 0.05, PAYTO, "t");
    const p = parse402({ url: "https://x/v1/check", status: 402, headers: { "payment-required": pr.header }, body: pr.body });
    expect(p.ok && p.terms).toMatchObject({ price: 0.05, network: "base", payee: PAYTO.toLowerCase() });
    const h = parse402({ url: "https://x", status: 402, headers: { "payment-required": pr.header }, body: "" }); // header-only form
    expect(h.ok).toBe(true);
  });
  it("X-PAYMENT: well-formed passes; wrong payTo, short value, expired, bad signature fail", () => {
    const req = paymentRequired("u", 0.05, PAYTO, "t").body.accepts[0]!;
    expect(verifyXPayment(demoXPayment(req, FROM), req).ok).toBe(true);
    const bad = (mut: (p: any) => void) => {
      const p = JSON.parse(Buffer.from(demoXPayment(req, FROM), "base64").toString());
      mut(p);
      return verifyXPayment(Buffer.from(JSON.stringify(p)).toString("base64"), req);
    };
    expect(bad((p) => (p.payload.authorization.to = FROM)).errors.join()).toMatch(/payTo/);
    expect(bad((p) => (p.payload.authorization.value = "1")).errors.join()).toMatch(/< required/);
    expect(bad((p) => (p.payload.authorization.validBefore = "1")).errors.join()).toMatch(/time window/);
    expect(bad((p) => (p.payload.signature = "0x12")).errors.join()).toMatch(/signature/);
    expect(verifyXPayment(undefined, req).ok).toBe(false);
    expect(verifyXPayment(demoXPayment(req, FROM), req).signature_verified).toBe(false); // dry-run: structure only
  });
});

describe("HTTP API", () => {
  it("/health and /v1/index.json: census payees with band, score, receipt id; bands sum", async () => {
    expect((await get("/health")).status).toBe(200);
    const j = JSON.parse((await get("/v1/index.json")).body);
    expect(j.payees.length).toBe(1923); // every Base payee in the catalog (refresh, 2026-11-13)
    expect(j.bands.ALLOW + j.bands.REVIEW + j.bands.BLOCK).toBe(1923);
    expect(j.payees[0]).toHaveProperty("receipt_id");
  });
  it("/ is static HTML with no script, headline and both cards", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.body).not.toMatch(/<script/i);
    expect(r.body).toContain("1,923 of 1,923 Base payees, 90-day window");
    expect(r.body).toContain("cleave.fi");
    expect(r.body).toContain("Featured · ALLOW");
  });
  it("/v1/check without X-PAYMENT -> 402 whose body our parser accepts; with it -> receipt id, dry-run", async () => {
    const url = "https://api.weatherly.example/v1/forecast"; // offline fixture
    const r402 = await get(`/v1/check?url=${encodeURIComponent(url)}`);
    expect(r402.status).toBe(402);
    const parsed = parse402({ url: "x", status: 402, headers: r402.headers, body: JSON.parse(r402.body) });
    expect(parsed.ok).toBe(true);
    const req = JSON.parse(r402.body).accepts[0];
    const r = await get(`/v1/check?url=${encodeURIComponent(url)}`, { "x-payment": demoXPayment(req, FROM) });
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.receipt_id).toMatch(/^[0-9a-f]{64}$/);
    expect(j.settlement).toBe("dry-run");
    expect(j.receipt.settlement).toBe("dry-run");
  });
  it("the live 402 states real x402 terms (Base USDC, atomic amount, 60 s) and parses back to our own payTo", async () => {
    const url = "https://api.weatherly.example/v1/forecast";
    const r402 = await get(`/v1/check?url=${encodeURIComponent(url)}`);
    const body = JSON.parse(r402.body);
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:8453", amount: "50000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: PAYTO, maxTimeoutSeconds: 60 });
    // the header alone carries the same terms
    expect(JSON.parse(Buffer.from(r402.headers["payment-required"]!, "base64").toString("utf8")).accepts).toEqual(body.accepts);
    const headerOnly = parse402({ url, status: 402, headers: { "payment-required": r402.headers["payment-required"]! }, body: "" });
    expect(headerOnly.ok && headerOnly.terms).toMatchObject({ price: 0.05, payee: PAYTO.toLowerCase() });
    // paying answers 200 with an X-PAYMENT-RESPONSE that says plainly nothing was settled
    const r = await get(`/v1/check?url=${encodeURIComponent(url)}`, { "x-payment": demoXPayment(body.accepts[0], FROM) });
    expect(r.status).toBe(200);
    const xr = JSON.parse(Buffer.from(r.headers["x-payment-response"]!, "base64").toString("utf8"));
    expect(xr).toMatchObject({ success: false, transaction: null, network: "eip155:8453", payer: FROM, settlement: "dry-run" });
  });
  it("/v1/verify: valid receipt true; one flipped byte false", async () => {
    const j = JSON.parse((await get("/v1/index.json")).body);
    const id = j.payees[5].receipt_id;
    expect(JSON.parse((await get(`/v1/verify?id=${id}`)).body).valid).toBe(true);
    const rec = JSON.parse((await get(`/v1/receipt/${id}`)).body).receipt;
    const ok = Buffer.from(JSON.stringify(rec)).toString("base64url");
    expect(JSON.parse((await get(`/v1/verify?receipt=${ok}`)).body).valid).toBe(true);
    const s = JSON.stringify(rec);
    const i = s.indexOf('"score":') + 8;
    const flipped = s.slice(0, i) + (s[i] === "9" ? "8" : "9") + s.slice(i + 1);
    expect(JSON.parse((await get(`/v1/verify?receipt=${Buffer.from(flipped).toString("base64url")}`)).body).valid).toBe(false);
  });
  it("/v1/payee/:addr is paid (402), /v1/badge is image/svg+xml", async () => {
    const j = JSON.parse((await get("/v1/index.json")).body);
    const addr = j.payees[0].payee;
    expect((await get(`/v1/payee/${addr}`)).status).toBe(402);
    const b = await get(`/v1/badge/${addr}.svg`);
    expect(b.status).toBe(200);
    expect(b.headers["content-type"]).toMatch(/image\/svg\+xml/);
  });
  it("HTML pages are static: a CSP that forbids every script, no <script>, no external request", async () => {
    for (const path of ["/", `/check?url=${encodeURIComponent("https://api.cleave.fi/x402/gas")}`]) {
      const r = await get(path);
      expect(r.status).toBe(200);
      const csp = r.headers["content-security-policy"] ?? "";
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toMatch(/script-src|connect-src|font-src/); // nothing but inline styles and data: images is allowed
      expect(r.body).not.toMatch(/<script/i);
      expect(r.body).not.toMatch(/(src|href|action)="https?:/i); // no external asset, link or form target
      expect(r.body).not.toMatch(/@import|url\((?!"data:)/i);
    }
  });
  it("/ lists every census payee with a receipt link, and the six vows", async () => {
    const body = (await get("/")).body;
    expect(new Set(body.match(/\/receipt\/[0-9a-f]{64}/g)).size).toBeGreaterThanOrEqual(1923);
    for (const v of ["null_payee", "age", "kinship", "history", "identity", "silence"]) expect(body).toContain(v);
    expect(body).toContain('action="/check"');
  });
  it("/check (free page): a null payee is BLOCKed with a sealed receipt and no model call", async () => {
    const before = modelCalls.length;
    const r = await get(`/check?url=${encodeURIComponent("https://api.cleave.fi/x402/gas")}`);
    expect(r.body).toContain("Blocked at probe time by vow I, null_payee.");
    const id = /\/receipt\/([0-9a-f]{64})/.exec(r.body)?.[1];
    expect(JSON.parse((await get(`/v1/verify?id=${id}`)).body).valid).toBe(true);
    const slip = await get(`/receipt/${id}`);
    expect(slip.status).toBe(200);
    expect(slip.body).toContain("This receipt checks out.");
    expect(slip.body).toContain(id!);
    expect(modelCalls.length).toBe(before);
  });
  it("/check: a census payee shows its cached band; an unknown payee gets no verdict; neither calls a model", async () => {
    const before = modelCalls.length;
    const tbs = await get(`/check?url=${encodeURIComponent("https://api.bitrefill.com/x402/gift-cards/search")}`);
    expect(tbs.body).toMatch(/Census band ALLOW, score \d/);
    // policy v5: every census answer shows its own data age and collection time
    expect(tbs.body).toMatch(/class="agebadge"><i class="st ALLOW"><\/i>Data \d+ hours old, inside the 72-hour window\./);
    expect(tbs.body).toContain("Data collected");
    const other = await get(`/check?url=${encodeURIComponent("https://api.weatherly.example/v1/forecast")}`); // synthetic fixture, not in the census
    expect(other.body).toContain("This payee is not in the census.");
    expect(other.body).toContain("never ALLOW by default");
    expect(modelCalls.length).toBe(before);
  });
  it("/check fails closed and escapes what it echoes", async () => {
    const bad = await get(`/check?url=${encodeURIComponent("javascript:alert(1)")}`);
    expect(bad.status).toBe(400);
    const xss = await get(`/check?url=${encodeURIComponent('https://not-recorded.example/"><script>alert(1)</script>')}`);
    expect(xss.status).toBe(200);
    expect(xss.body).toContain("The probe did not get usable payment terms.");
    expect(xss.body).not.toMatch(/<script/i);
    expect(xss.body).toContain("&lt;script&gt;");
    expect((await get(`/receipt/${"0".repeat(64)}`)).status).toBe(404);
  });
  it("/docs and /legal render the Markdown documents as static pages, linked from every page", async () => {
    for (const [path, heading] of [["/guide", "Try it: real paid endpoints"], ["/docs", "Fiangshi docs"], ["/cli", "Exit codes"], ["/report", "Every failure, in order"], ["/architecture", "The map"], ["/connect", "Claude Code"], ["/legal", "Terms of use"]] as const) {
      const r = await get(path);
      expect(r.status).toBe(200);
      expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(r.body).not.toMatch(/<script/i);
      expect(r.body).toContain(heading);
      expect(r.body).toContain(path === "/docs" ? "Docs home" : "On this page");
    }
    for (const path of ["/", `/check?url=${encodeURIComponent("https://api.cleave.fi/x402/gas")}`, "/guide", "/report", "/legal"]) {
      const body = (await get(path)).body;
      expect(body).toContain('<a href="/guide">Guide</a>');
      expect(body).toContain('<a href="/report">Test report</a>');
      expect(body).toContain('<a href="/architecture">Architecture</a>');
      expect(body).toContain('<a href="/connect">Connect</a>');
      expect(body).toContain('<a class="brand" href="/">FIANGSHI</a>');
      expect(body).toContain('<a href="/legal">Legal</a>');
    }
    // links between the two Markdown files point at the routes, not at file names
    expect((await get("/guide")).body).not.toContain("LEGAL.md)");
    expect((await get("/legal")).body).toContain('<a href="/guide">guide</a>');
  });
  it("/legal shows the operator contact from FIANGSHI_CONTACT, escaped, and never invents one", async () => {
    const saved = process.env.FIANGSHI_CONTACT;
    delete process.env.FIANGSHI_CONTACT;
    expect((await get("/legal")).body).toContain("has no operator contact set");
    process.env.FIANGSHI_CONTACT = "ops@fiangshi.example";
    expect((await get("/legal")).body).toContain('<a href="mailto:ops@fiangshi.example">ops@fiangshi.example</a>');
    process.env.FIANGSHI_CONTACT = '"><script>x()</script>';
    const odd = (await get("/legal")).body;
    expect(odd).not.toMatch(/<script/i);
    expect(odd).toContain("&lt;script&gt;x()&lt;/script&gt;");
    if (saved === undefined) delete process.env.FIANGSHI_CONTACT;
    else process.env.FIANGSHI_CONTACT = saved;
  });
  it("a payee outside the census, on a server without live providers: cached price, cold 'unavailable', REVIEW, no Surf", async () => {
    const url = "https://api.weatherly.example/v1/forecast"; // synthetic fixture payee, not in the census
    const r402 = JSON.parse((await get(`/v1/check?url=${encodeURIComponent(url)}`)).body);
    expect(r402.accepts[0].amount).toBe("50000"); // $0.05: no cold fetch can happen here, so the cold price is not asked
    const r = JSON.parse((await get(`/v1/check?url=${encodeURIComponent(url)}`, { "x-payment": demoXPayment(r402.accepts[0], FROM) })).body);
    expect(r).toMatchObject({ sku: "cached", in_census: false, band: "REVIEW", cost_usd: 0.05 });
    expect(r.cold).toMatchObject({ ok: false, reason: "unavailable", surf_calls: 0 });
    expect(r.receipt.evidence.some((e: { signal: string }) => e.signal === "cold_check")).toBe(true);
  });
  it("docs: one Docs link in the bar, a docs home, and a sidebar with the current page and previous / next", async () => {
    const home = (await get("/")).body;
    const bar = /<header class="bar">[\s\S]*?<\/header>/.exec(home)?.[0] ?? "";
    expect(bar).toContain('<a href="/docs">Docs</a>');
    for (const p of ["/guide", "/connect", "/report", "/legal", "/architecture"]) expect(bar).not.toContain(`href="${p}"`);
    const hub = (await get("/docs")).body;
    for (const p of ["/guide", "/connect", "/cli", "/architecture", "/report", "/legal"]) expect(hub).toContain(`<a class="dcard" href="${p}">`);
    const cli = (await get("/cli")).body;
    expect(cli).toContain('<a href="/cli" aria-current="page">CLI and skill</a>');
    expect(cli).toContain('<p class="crumbs"><a href="/docs">Docs</a>');
    expect(cli).toContain('class="pv" href="/connect"');
    expect(cli).toContain('class="nx" href="/architecture"');
    expect(cli).not.toMatch(/<script/i);
  });
  it("the hero is the check panel alone: no clock, no poster, no dragon, no images", async () => {
    const home = (await get("/")).body;
    expect(home).not.toMatch(/<script/i);
    expect(home).not.toContain('class="clock"');
    expect(home).toContain('<form class="probe"');
    expect(home).not.toMatch(/(src|href)="\/assets\//); // no image or asset link (an endpoint URL may contain /assets/)
    expect(home).not.toMatch(/<img/i);
    for (const a of ["/assets/guardian-poster.webp", "/assets/dragon.webp", "/assets/ticket.webp"]) expect((await get(a)).status).toBe(404);
  });
  it("/report computes the lab history from fixtures/lab and lists every run", async () => {
    const body = (await get("/report")).body;
    expect(body).toContain("Lab runs, as committed");
    expect(body).toContain("results.json");
    expect(body).toContain("results-attempt5.json");
    expect(body).toContain("3 / 9");
    expect(body).toContain("SUPERSEDED");
  });
  it("paid endpoints refuse to run without a configured payTo (no address invented)", async () => {
    const saved = process.env.FIANGSHI_PAYTO;
    delete process.env.FIANGSHI_PAYTO;
    expect((await get(`/v1/payee/0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`)).status).toBe(503);
    process.env.FIANGSHI_PAYTO = saved;
  });
});

describe("the server survives a failing request", () => {
  it("an error after the reply has started ends that reply; the server keeps answering", async () => {
    const { handle } = await import("../src/api/server.js");
    const { ServerResponse, IncomingMessage } = await import("node:http");
    const { Socket } = await import("node:net");
    const req = new IncomingMessage(new Socket());
    req.method = "GET";
    req.url = "/health";
    const res = new ServerResponse(req);
    // simulate a handler that already sent headers and then threw: writeHead twice must not throw out of handle()
    res.writeHead(200);
    const write = res.writeHead.bind(res);
    res.writeHead = (() => {
      throw Object.assign(new Error("Cannot write headers after they are sent to the client"), { code: "ERR_HTTP_HEADERS_SENT" });
    }) as typeof res.writeHead;
    await expect(handle(req, res)).resolves.toBeUndefined();
    res.writeHead = write;
    expect((await get("/health")).status).toBe(200);
  });
});
