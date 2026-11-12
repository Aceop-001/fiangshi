/**
 * Fiangshi HTTP API (node:http, no framework). Census state is built at startup from committed fixtures (0 credits).
 *   GET /                       the site: census, case files, vows, funders, ledger (static HTML, no JS)
 *   GET /check?url=             free HTML probe: unpaid GET, null-payee gate, cached census band (no model, no data call)
 *   GET /receipt/:id            a receipt as an HTML slip with its verification result
 *   GET /docs, GET /legal       docs/GUIDE.md and docs/LEGAL.md rendered as pages
 *   GET /health                 free
 *   GET /v1/index.json          free · every census payee with band, score, receipt id
 *   GET /v1/payee/:addr         $0.02 · x402 402 without X-PAYMENT; census record + receipt id with it
 *   GET /v1/check?url=          V6 payTo -> BLOCK at $0.00 with no payment and no model call;
 *                               otherwise $0.05 · 402 without X-PAYMENT; verdict + receipt with it (SERV || Dolphin, vows)
 *   GET /v1/receipt/:id         free · full receipt JSON (census or live ledger)
 *   GET /v1/verify?id=|receipt= free · recompute the hash (and chain link); receipt = base64url JSON
 *   GET /v1/badge/:addr.svg     free · colour by band
 * Settlement is "dry-run": X-PAYMENT is validated structurally, nothing is settled, no tx hash is invented.
 * Usage: npm run dev  (127.0.0.1:8787; PORT / HOST, or --port N, to override)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadDotEnv, num, providerMode } from "../config.js";
import { loadCensus, loadDemoStats } from "../census.js";
import { badgeSvg, renderCheck, renderDoc, renderIndex, renderNotFound, renderReceipt } from "../site.js";
import { CSP, setPagePath } from "../site-theme.js";
import { lang, setLang, type Lang } from "../i18n.js";
import { probe } from "../adapters/probe.js";
import { modelCalls } from "../adapters/serv.js";
import { paymentRequired, sellerPayTo, verifyXPayment, currentSettlement, type Requirement } from "../adapters/x402.js";
import { check, emptySignals, evaluateFull } from "../check.js";
import { coldCacheHit, coldSignals, type ColdFetcher } from "../cold.js";
import { surfColdFetcher } from "../cold-surf.js";

/** The cold-check data source. Tests replace it so they never reach the Surf CLI. */
let coldFetcher: ColdFetcher = surfColdFetcher;
export const setColdFetcher = (f: ColdFetcher) => (coldFetcher = f);
import { hashOf } from "../core/canonical.js";
import { verifyReceipt } from "../core/receipt.js";
import { v6 } from "../core/v6.js";
import { Receipt } from "../core/types.js";
import { appendReceipt, ledgerPath, readLedger } from "../ledger/store.js";

/** Static brand images the pages use (img-src 'self'). */
const ASSETS: Record<string, { file: string; type: string }> = {
};

/** Every JSON response says which providers produced it: "fixture" (recorded replies replayed) or "live". */
const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-fiangshi-mode": providerMode(), ...headers });
  const out = body && typeof body === "object" && !Array.isArray(body) ? { mode: providerMode(), ...(body as object) } : body;
  res.end(JSON.stringify(out, null, 2));
};

/** HTML pages are static documents: the CSP forbids every script and every external request. */
const html = (res: ServerResponse, status: number, body: string) => {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-fiangshi-mode": providerMode(),
    "content-language": lang() === "zh" ? "zh-Hans" : lang(),
  });
  res.end(localiseLinks(body));
};

/** Keep visitors in their language: site links and the probe form get the /zh|/ja|/ko prefix; API, assets and the switcher do not. */
function localiseLinks(body: string): string {
  const l = lang();
  if (l === "en") return body;
  return body.replace(/<(a|form)\b([^>]*)>/g, (tag, _name: string, attrs: string) =>
    attrs.includes("data-nolang") ? tag : tag.replace(/\b(href|action)="\/(?!v1\/)([^"]*)"/, (_m, k: string, rest: string) => `${k}="/${l}${rest ? `/${rest}` : ""}"`),
  );
}

function findReceipt(id: string): { r: Receipt; chain: "census" | "ledger"; list: Receipt[] } | null {
  const c = loadCensus();
  const cr = c.receipts.get(id);
  if (cr) return { r: cr, chain: "census", list: c.ledger };
  const list = readLedger(ledgerPath()).flatMap((x) => {
    const p = Receipt.safeParse(x);
    return p.success ? [p.data] : [];
  });
  const r = list.find((x) => x.receipt_hash === id);
  return r ? { r, chain: "ledger", list } : null;
}

/** Hash recomputation + chain link: the receipt must hash to itself, and (if known) follow its predecessor. */
function verifyOne(obj: unknown): { valid: boolean; errors: string[]; chain: string } {
  const v = verifyReceipt(obj);
  if (!v.ok) return { valid: false, errors: v.errors, chain: "n/a" };
  const r = obj as Receipt;
  const known = findReceipt(r.receipt_hash);
  if (!known) return { valid: true, errors: [], chain: "not in a known ledger (hash self-consistent)" };
  const i = known.list.findIndex((x) => x.receipt_hash === r.receipt_hash);
  const prev = i <= 0 ? "genesis" : known.list[i - 1]!.receipt_hash;
  if (r.prev_hash !== prev) return { valid: false, errors: [`prev_hash ${r.prev_hash} does not link to ${prev}`], chain: known.chain };
  return { valid: true, errors: [], chain: `${known.chain} #${i}` };
}

function requirePayment(req: IncomingMessage, res: ServerResponse, resource: string, usd: number, description: string): { ok: true; requirement: Requirement; from: string | null } | null {
  const seller = sellerPayTo();
  if (!seller.ok) {
    json(res, 503, { error: seller.error });
    return null;
  }
  const pr = paymentRequired(resource, usd, seller.payTo, description);
  const requirement = pr.body.accepts[0]!;
  const header = req.headers["x-payment"];
  const xp = Array.isArray(header) ? header[0] : header;
  if (!xp) {
    json(res, 402, pr.body, { "payment-required": pr.header });
    return null;
  }
  const chk = verifyXPayment(xp, requirement);
  if (!chk.ok) {
    json(res, 402, { ...pr.body, error: `invalid X-PAYMENT: ${chk.errors.join("; ")}` }, { "payment-required": pr.header });
    return null;
  }
  return { ok: true, requirement, from: chk.from };
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = new URL(req.url ?? "/", "http://localhost");
  // language prefix for the HTML pages: /zh, /ja, /ko (no cookie, no script); English has none
  const lm = /^\/(zh|ja|ko)(?=\/|$)/.exec(u.pathname);
  setLang(lm ? (lm[1] as Lang) : "en");
  if (lm) u.pathname = u.pathname.slice(lm[0].length) || "/";
  setPagePath(u.pathname + u.search);
  const c = loadCensus();
  const self = `http://${req.headers.host ?? "127.0.0.1"}`;
  try {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    if (u.pathname === "/") return html(res, 200, renderIndex(c, loadDemoStats()));
    if (ASSETS[u.pathname]) {
      // brand images, by exact name only (no path is ever built from the request)
      res.writeHead(200, { "content-type": ASSETS[u.pathname]!.type, "cache-control": "max-age=3600", "x-content-type-options": "nosniff", "x-fiangshi-mode": providerMode() });
      return void res.end(readFileSync(join(ROOT, "assets", ASSETS[u.pathname]!.file)));
    }
    if (u.pathname === "/guide" || u.pathname === "/docs") return html(res, 200, renderDoc("docs", c, loadDemoStats()));
    if (u.pathname === "/report") return html(res, 200, renderDoc("report", c, loadDemoStats()));
    if (u.pathname === "/legal") return html(res, 200, renderDoc("legal", c, loadDemoStats()));
    if (u.pathname === "/check") {
      // Free page: one unpaid probe, the V6 gate, and the census band already published in /v1/index.json. Never a model call.
      const input = (u.searchParams.get("url") ?? "").trim();
      const page = (status: number, v: Parameters<typeof renderCheck>[0]) => html(res, status, renderCheck(v, c, self, loadDemoStats()));
      if (!/^https?:\/\/\S{1,2000}$/i.test(input)) return page(400, { kind: "invalid", input: input.slice(0, 200) });
      const pr = await probe(input);
      if (!pr.ok) return page(200, { kind: "probe_failed", url: input, error: pr.error });
      if (v6({ payTo: pr.payTo_raw, asset: pr.terms.asset }).band === "BLOCK") {
        const r = await check(input, { probe: pr }); // same probe: the sealed receipt is for exactly what was shown
        return page(200, { kind: "blocked", url: input, terms: pr.terms, payTo: pr.payTo_raw, reason: r.decision.verdict.citations[0]?.quote ?? "null payee", receipt: r.receipt });
      }
      const cp = c.payees.find((x) => x.payee === pr.terms.payee);
      return page(200, cp ? { kind: "census", url: input, terms: pr.terms, payTo: pr.payTo_raw, payee: cp } : { kind: "unknown", url: input, terms: pr.terms, payTo: pr.payTo_raw });
    }
    const hm = /^\/receipt\/([0-9a-f]{64})$/.exec(u.pathname);
    if (hm) {
      const f = findReceipt(hm[1]!);
      return f ? html(res, 200, renderReceipt(f.r, verifyOne(f.r), c, self, loadDemoStats())) : html(res, 404, renderNotFound("No receipt with that id.", c, loadDemoStats()));
    }
    if (u.pathname === "/health") return json(res, 200, { ok: true, census_payees: c.payees.length, census_at: c.at, settlement: currentSettlement() });
    if (u.pathname === "/v1/index.json")
      return json(res, 200, {
        census_at: c.at,
        window_days: c.window_days,
        coverage: `${c.payees.length} of ${c.catalog_payees} Base payees`,
        bands: c.bands,
        chain: "eip155:8453",
        payees: c.payees.map((p) => ({ chain: p.chain, payee: p.payee, url: p.url, band: p.band, score: p.score, vows: p.vows, receipt_id: p.receipt_id })),
      });
    let m = /^\/v1\/badge\/(0x[0-9a-fA-F]{40})\.svg$/.exec(u.pathname);
    if (m) {
      const p = c.payees.find((x) => x.payee === m![1]!.toLowerCase());
      res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "max-age=300", "x-fiangshi-mode": providerMode() });
      return void res.end(badgeSvg(p?.band ?? null, p?.score ?? null));
    }
    m = /^\/v1\/receipt\/([0-9a-f]{64})$/.exec(u.pathname);
    if (m) {
      const f = findReceipt(m[1]!);
      return f ? json(res, 200, { chain: f.chain, receipt: f.r }) : json(res, 404, { error: "unknown receipt id" });
    }
    if (u.pathname === "/v1/verify") {
      const id = u.searchParams.get("id");
      const raw = u.searchParams.get("receipt");
      if (raw) {
        let obj: unknown;
        try {
          obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        } catch {
          return json(res, 200, { valid: false, errors: ["receipt is not base64url JSON"] });
        }
        return json(res, 200, verifyOne(obj));
      }
      if (id) {
        const f = findReceipt(id);
        return f ? json(res, 200, { id, ...verifyOne(f.r) }) : json(res, 200, { id, valid: false, errors: ["unknown receipt id"] });
      }
      return json(res, 400, { error: "pass ?id=<receipt id> or ?receipt=<base64url receipt JSON>" });
    }
    m = /^\/v1\/payee\/(0x[0-9a-fA-F]{40})$/.exec(u.pathname);
    if (m) {
      const pay = requirePayment(req, res, `${self}${u.pathname}`, num("FIANGSHI_PRICE_PAYEE", 0.02), "Fiangshi payee record");
      if (!pay) return;
      const p = c.payees.find((x) => x.payee === m![1]!.toLowerCase());
      return json(res, p ? 200 : 404, p ? { ...p, settlement: "dry-run", payer: pay.from, receipt_id: p.receipt_id } : { error: "payee not in the census", settlement: "dry-run" });
    }
    if (u.pathname === "/v1/check") {
      const target = u.searchParams.get("url");
      if (!target || !/^https?:\/\//.test(target)) return json(res, 400, { error: "pass ?url=<x402 endpoint>" });
      const t0 = performance.now();
      const mc0 = modelCalls.length;
      const pr = await probe(target);
      // V6 at probe time: a null/sink payTo is BLOCKed before any spend: no payment asked, no data or model call
      if (pr.ok && v6({ payTo: pr.payTo_raw, asset: pr.terms.asset }).band === "BLOCK") {
        const r = await check(target, { probe: pr });
        return json(res, 200, { band: r.decision.verdict.band, vow_fired: r.decision.verdict.vow_fired, reason: r.decision.verdict.citations[0]?.quote, cost_usd: 0, model_calls: modelCalls.length - mc0, receipt_id: r.receipt.receipt_hash, receipt: r.receipt, settlement: "dry-run", ms: Math.round(performance.now() - t0) });
      }
      // Cached SKU: a census payee or a cold payee fetched in the last 72 h. Cold SKU: anyone else, fetched live from Surf.
      const terms = pr.ok ? pr.terms : null;
      const payee = terms?.payee ?? "unknown";
      const cp = c.payees.find((x) => x.payee === payee);
      const coldLive = providerMode() === "live";
      const cachedCold = !cp && terms ? coldCacheHit(payee) : false;
      const sku: "cached" | "cold" = cp || cachedCold || !terms || !coldLive ? "cached" : "cold";
      const price = sku === "cold" ? num("FIANGSHI_PRICE_CHECK_COLD", 0.15) : num("FIANGSHI_PRICE_CHECK", 0.05);
      const pay = requirePayment(req, res, `${self}/v1/check?url=${encodeURIComponent(target)}`, price, sku === "cold" ? "Fiangshi counterparty check (cold: live on-chain fetch)" : "Fiangshi counterparty check");
      if (!pay) return;
      let s = c.signals.get(payee) ?? emptySignals(payee);
      let cold: Record<string, unknown> | null = null;
      if (!cp && terms) {
        if (!coldLive && !cachedCold) cold = { ok: false, reason: "unavailable", detail: `cold checks need live providers (this server runs in ${providerMode()} mode)`, surf_calls: 0 };
        else {
          const r = await coldSignals(payee, terms.network, c, coldFetcher);
          if (r.ok) s = r.signals;
          const { signals: _omit, ...meta } = r as Record<string, unknown>;
          cold = meta;
        }
      }
      const full = await evaluateFull(terms, s, c.funderLabels, cp?.service?.trim() || null, { url: target, catalogName: cp?.service ?? null, labelName: null });
      const d = full.decision;
      const coldNote = cold && cold.ok === false ? [{ signal: "cold_check", quote: `${String(cold.reason)}: ${String(cold.detail)}` }] : [];
      const receipt = appendReceipt({
        payee,
        url: target,
        terms_hash: terms?.terms_hash ?? hashOf({ url: target, probe_error: pr.ok ? null : pr.error }),
        price: terms?.price ?? null,
        band: d.verdict.band,
        score: d.verdict.score,
        vow_fired: d.verdict.vow_fired ?? null,
        evidence: [...d.verdict.citations, ...coldNote],
        model: { verdict: d.modelRawBand, extractor: full.extraction ? (full.extraction.claims ? "dolphin" : "dolphin:failed") : "none", degraded: d.verdict.degraded },
        snapshot_id: cp ? hashOf({ census: "w90", at: c.at }) : hashOf({ cold: payee, fetched_at: (cold?.fetched_at as string | undefined) ?? null }),
        checked_at: new Date().toISOString(),
        settlement: currentSettlement(),
        enrichment: full.enrichment,
      });
      return json(res, 200, {
        band: d.verdict.band,
        score: d.verdict.score,
        vow_fired: d.verdict.vow_fired ?? null,
        vows: d.vows.filter((v) => v.fired).map((v) => ({ vow: v.vow, band: v.band, reason: v.reason, ...(v.flags ? { flags: v.flags } : {}) })),
        model: { serv: d.modelRawBand, degraded: d.verdict.degraded },
        enrichment: full.enrichment,
        in_census: Boolean(cp),
        sku,
        cold,
        probe: pr.ok ? { price: pr.terms.price, payee: pr.terms.payee } : { error: pr.error },
        cost_usd: price,
        payer: pay.from,
        settlement: "dry-run",
        model_calls: modelCalls.length - mc0,
        receipt_id: receipt.receipt_hash,
        receipt,
        ms: Math.round(performance.now() - t0),
      });
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    // a reply already under way cannot get a second status line: end it instead of crashing the server
    if (res.headersSent) return void res.end();
    return json(res, 500, { error: (e as Error).message.slice(0, 300) });
  }
}

export function startServer(port = num("PORT", 8787), host = process.env.HOST ?? "127.0.0.1") {
  if (process.env.FIANGSHI_REPLAY === "1") process.env.FIANGSHI_OFFLINE = "1"; // fixture mode: recorded 402s, never the network
  if (process.env.FIANGSHI_OFFLINE !== "1") process.env.SNAPSHOT_SOURCE = "live"; // probe live endpoints
  process.env.MOCK_MODELS ??= "";
  loadCensus(); // fail fast if fixtures are missing
  // one failed request must never take the server down
  const server = createServer((req, res) =>
    handle(req, res).catch((e) => {
      process.stderr.write(`request failed: ${(e as Error).message}\n`);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end();
    }),
  );
  return new Promise<typeof server>((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv();
  const portArg = process.argv.indexOf("--port");
  const s = portArg > 0 && Number(process.argv[portArg + 1]) > 0 ? await startServer(Number(process.argv[portArg + 1])) : await startServer();
  const a = s.address();
  console.log(`fiangshi listening on http://${typeof a === "object" && a ? `${a.address}:${a.port}` : a} (providers: ${providerMode()})`);
}
