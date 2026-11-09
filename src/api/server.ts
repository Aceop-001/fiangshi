/**
 * Fiangshi HTTP API (node:http, no framework). Census state is built at startup from committed fixtures (0 credits).
 *   GET /                       static index (no JS)
 *   GET /health                 free
 *   GET /v1/index.json          free · every census payee with band, score, receipt id
 *   GET /v1/payee/:addr         $0.02 · x402 402 without X-PAYMENT; census record + receipt id with it
 *   GET /v1/check?url=          V6 payTo -> BLOCK at $0.00 with no payment and no model call;
 *                               otherwise $0.05 · 402 without X-PAYMENT; verdict + receipt with it (SERV || Dolphin, vows)
 *   GET /v1/receipt/:id         free · full receipt JSON (census or live ledger)
 *   GET /v1/verify?id=|receipt= free · recompute the hash (and chain link); receipt = base64url JSON
 *   GET /v1/badge/:addr.svg     free · colour by band
 * Settlement is "dry-run": X-PAYMENT is validated structurally, nothing is settled, no tx hash is invented.
 * Usage: npm run dev  (127.0.0.1:8787; PORT / HOST to override)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadDotEnv, num } from "../config.js";
import { loadCensus, loadDemoStats } from "../census.js";
import { badgeSvg, renderIndex } from "../site.js";
import { probe } from "../adapters/probe.js";
import { modelCalls } from "../adapters/serv.js";
import { paymentRequired, sellerPayTo, verifyXPayment, currentSettlement, type Requirement } from "../adapters/x402.js";
import { check, emptySignals, evaluateFull } from "../check.js";
import { hashOf } from "../core/canonical.js";
import { verifyReceipt } from "../core/receipt.js";
import { v6 } from "../core/v6.js";
import { Receipt } from "../core/types.js";
import { appendReceipt, ledgerPath, readLedger } from "../ledger/store.js";

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body, null, 2));
};

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
  const c = loadCensus();
  const self = `http://${req.headers.host ?? "127.0.0.1"}`;
  try {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    if (u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end(renderIndex(c, loadDemoStats()));
    }
    if (u.pathname === "/health") return json(res, 200, { ok: true, census_payees: c.payees.length, census_at: c.at, settlement: currentSettlement() });
    if (u.pathname === "/v1/index.json")
      return json(res, 200, {
        census_at: c.at,
        window_days: c.window_days,
        coverage: `${c.payees.length} of ${c.catalog_payees} Base payees`,
        bands: c.bands,
        payees: c.payees.map((p) => ({ payee: p.payee, url: p.url, band: p.band, score: p.score, vows: p.vows, receipt_id: p.receipt_id })),
      });
    let m = /^\/v1\/badge\/(0x[0-9a-fA-F]{40})\.svg$/.exec(u.pathname);
    if (m) {
      const p = c.payees.find((x) => x.payee === m![1]!.toLowerCase());
      res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "max-age=300" });
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
        const r = await check(target, {});
        return json(res, 200, { band: r.decision.verdict.band, vow_fired: r.decision.verdict.vow_fired, reason: r.decision.verdict.citations[0]?.quote, cost_usd: 0, model_calls: modelCalls.length - mc0, receipt_id: r.receipt.receipt_hash, receipt: r.receipt, settlement: "dry-run", ms: Math.round(performance.now() - t0) });
      }
      const pay = requirePayment(req, res, `${self}/v1/check?url=${encodeURIComponent(target)}`, num("FIANGSHI_PRICE_CHECK", 0.05), "Fiangshi counterparty check");
      if (!pay) return;
      const terms = pr.ok ? pr.terms : null;
      const payee = terms?.payee ?? "unknown";
      const cp = c.payees.find((x) => x.payee === payee);
      const s = c.signals.get(payee) ?? emptySignals(payee);
      const full = await evaluateFull(terms, s, c.funderLabels, cp?.service?.trim() || null, { url: target, catalogName: cp?.service ?? null, labelName: null });
      const d = full.decision;
      const receipt = appendReceipt({
        payee,
        url: target,
        terms_hash: terms?.terms_hash ?? hashOf({ url: target, probe_error: pr.ok ? null : pr.error }),
        price: terms?.price ?? null,
        band: d.verdict.band,
        score: d.verdict.score,
        vow_fired: d.verdict.vow_fired ?? null,
        evidence: d.verdict.citations,
        model: { verdict: d.modelRawBand, extractor: full.extraction ? (full.extraction.claims ? "dolphin" : "dolphin:failed") : "none", degraded: d.verdict.degraded },
        snapshot_id: hashOf({ census: "w90", at: c.at }),
        checked_at: new Date().toISOString(),
        settlement: currentSettlement(),
        enrichment: full.enrichment,
      });
      return json(res, 200, {
        band: d.verdict.band,
        score: d.verdict.score,
        vow_fired: d.verdict.vow_fired ?? null,
        vows: d.vows.filter((v) => v.fired).map((v) => ({ vow: v.vow, band: v.band, reason: v.reason })),
        model: { serv: d.modelRawBand, degraded: d.verdict.degraded },
        enrichment: full.enrichment,
        in_census: Boolean(cp),
        probe: pr.ok ? { price: pr.terms.price, payee: pr.terms.payee } : { error: pr.error },
        cost_usd: num("FIANGSHI_PRICE_CHECK", 0.05),
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
    return json(res, 500, { error: (e as Error).message.slice(0, 300) });
  }
}

export function startServer(port = num("PORT", 8787), host = process.env.HOST ?? "127.0.0.1") {
  if (process.env.FIANGSHI_OFFLINE !== "1") process.env.SNAPSHOT_SOURCE = "live"; // probe live endpoints
  process.env.MOCK_MODELS ??= "";
  loadCensus(); // fail fast if fixtures are missing
  const server = createServer((req, res) => void handle(req, res));
  return new Promise<typeof server>((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv();
  const s = await startServer();
  const a = s.address();
  console.log(`fiangshi listening on http://${typeof a === "object" && a ? `${a.address}:${a.port}` : a}`);
}
