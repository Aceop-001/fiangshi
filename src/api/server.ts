/**
 * Fiangshi HTTP API (node:http, no framework). Census state is built at startup from committed fixtures (0 credits).
 *   GET /                       the site: census, case files, vows, funders, ledger (static HTML, no JS)
 *   GET /check?url=             free HTML probe: unpaid GET, null-payee gate, cached census band (no model, no data call)
 *   GET /receipt/:id            a receipt as an HTML slip with its verification result
 *   GET /docs                   the documentation home; /guide /connect /cli /architecture /report /legal render docs/*.md
 *   GET /v1/preview?url=        free JSON · unpaid probe, null-payee gate, census answer (the MCP server's free tool)
 *   GET /health                 free
 *   GET /openapi.json           free · OpenAPI 3.1 description of every route
 *   GET /v1/index.json          free · every census payee with band, score, receipt id
 *   GET /v1/census/status       free · freshness now, the next planned refresh, what the last refresh did
 *   GET /v1/payee/:addr         $0.02 · x402 402 without X-PAYMENT; census record + receipt id with it
 *   GET /v1/check?url=          V6 payTo -> BLOCK at $0.00 with no payment and no model call;
 *                               otherwise $0.05 · 402 without X-PAYMENT; verdict + receipt with it (SERV || Dolphin, vows)
 *   GET /v1/receipt/:id         free · full receipt JSON (census, live ledger, or the durable store)
 *   GET /v1/receipts/:id        free · the stored receipt plus its verify result
 *   GET /v1/verify?id=|receipt= free · recompute the hash (and chain link); receipt = base64url JSON
 *   GET /v1/badge/:addr.svg     free · colour by band
 * Settlement is "dry-run" by default: the payment is validated structurally, nothing is settled, no tx hash is invented.
 * With FIANGSHI_SETTLE=live the CDP x402 facilitator verifies and settles it (src/adapters/facilitator.ts).
 * Usage: npm run dev  (127.0.0.1:8787; PORT / HOST, or --port N, to override)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadDotEnv, nowMs, num, providerMode, staleHours } from "../config.js";
import { legacyCensus, loadCensus, loadDemoStats } from "../census.js";
import { badgeSvg, renderCheck, renderDoc, renderDocsHome, renderIndex, renderJudges, renderNotFound, renderReceipt } from "../site.js";
import { COPY_SCRIPT_CSP, CSP, setPagePath } from "../site-theme.js";
import { docByPath } from "../docs-index.js";
import { lang, setLang, type Lang } from "../i18n.js";
import { probe } from "../adapters/probe.js";
import { modelCalls } from "../adapters/serv.js";
import { decodeReceiptParam, receiptVerifyUrl } from "../receipt-url.js";
import { paymentRequired, paymentResponse, sellerPayTo, verifyXPayment, currentSettlement, type Requirement } from "../adapters/x402.js";
import { facilitatorSettle, facilitatorVerify, isTxHash, settleMode, settleReady } from "../adapters/facilitator.js";
import { check, emptySignals, evaluateFull } from "../check.js";
import { POLICY_V4, POLICY_VERSION, bandFromBasis, v5Fields } from "../core/cap.js";
import { censusAnswer, freshness, noRecordAnswer, noVerdictAnswer, nullPayeeAnswer, type PaidStatus } from "../preview.js";
import { coldCacheHit, coldSignals, type ColdFetcher } from "../cold.js";
import { surfColdFetcher } from "../cold-surf.js";

/** The cold-check data source. Tests replace it so they never reach the Surf CLI. */
let coldFetcher: ColdFetcher = surfColdFetcher;
export const setColdFetcher = (f: ColdFetcher) => (coldFetcher = f);
import { hashOf } from "../core/canonical.js";
import { verifyReceipt } from "../core/receipt.js";
import { v6 } from "../core/v6.js";
import { Receipt } from "../core/types.js";
import { censusStatus, readRuns } from "../census-status.js";
import { openapi } from "../openapi.js";
import { appendReceipt, currentEpoch, ledgerBaseHash, ledgerDurability, ledgerPath, readLedger, restoreFromGithub, restoreFromMirror } from "../ledger/store.js";
import { fetchStoredReceipt, githubStoreOn, receiptsRepo } from "../ledger/github.js";

/** Static brand images the pages use (img-src 'self'). */
const ASSETS: Record<string, { file: string; type: string }> = {
};

/** The one cookie the site sets: it only remembers that the first-visit tour was closed. Disclosed in docs/LEGAL.md. */
export const TOUR_COOKIE = "fiangshi_tour=done";
const tourDone = (req: IncomingMessage) => (req.headers.cookie ?? "").split(";").some((c) => c.trim() === TOUR_COOKIE);
/** A same-site path to return to after the tour; anything else (another host, "//", a scheme) goes home. */
export function safeNext(raw: string | null): string {
  const n = (raw ?? "/").trim();
  return /^\/(?![/\\])[\w\-./#?=&%]{0,200}$/.test(n) ? n : "/";
}

/** Every JSON response says which providers produced it: "fixture" (recorded replies replayed) or "live". */
const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-fiangshi-mode": providerMode(), ...headers });
  const out = body && typeof body === "object" && !Array.isArray(body) ? { mode: providerMode(), ...(body as object) } : body;
  res.end(JSON.stringify(out, null, 2));
};

/** HTML pages are static documents: the CSP forbids every script and every external request. */
const html = (res: ServerResponse, status: number, body: string, copyScript = false) => {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": copyScript ? COPY_SCRIPT_CSP : CSP,
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

const UNKNOWN_ID = { error: "unknown receipt id: the live ledger resets on redeploy", hint: "if you kept the receipt, verify it with ?receipt=<base64url JSON>" };

function findReceipt(id: string): { r: Receipt; chain: "census" | "ledger"; list: Receipt[] } | null {
  const c = loadCensus();
  const cr = c.receipts.get(id);
  // a receipt from an older census (9 Nov, or a superseded refresh) links within its own chain, not the one served now
  if (cr) return { r: cr, chain: "census", list: c.chains.find((l) => l.some((x) => x.receipt_hash === id)) ?? c.ledger };
  const list = readLedger(ledgerPath()).flatMap((x) => {
    // schema-checked, but returned exactly as stored, so /v1/receipt/:id is byte-identical to the paid answer's receipt
    return Receipt.safeParse(x).success ? [x as Receipt] : [];
  });
  const r = list.find((x) => x.receipt_hash === id);
  return r ? { r, chain: "ledger", list } : null;
}

type Found = { r: Receipt; source: "census" | "ledger" | "store" };
/** A receipt by id: the census, this process's ledger, then the durable GitHub store (survives redeploys). */
async function lookupReceipt(id: string): Promise<Found | null> {
  const local = findReceipt(id);
  if (local) return { r: local.r, source: local.chain };
  const stored = await fetchStoredReceipt(id).catch(() => null);
  return stored ? { r: stored.receipt, source: "store" } : null;
}
/**
 * Verify a found receipt. A stored one is re-hashed from the stored bytes and its band re-derived; its link is checked
 * against the store: the predecessor it names must be stored too (or be genesis, or held here) and hash to that name.
 */
async function verifyFound(f: Found): Promise<VerifyOut> {
  const out = verifyOne(f.r, "id");
  if (f.source !== "store" || !out.valid) return out;
  const prev = f.r.prev_hash;
  const held = prev === "genesis" || findReceipt(prev) !== null || (await fetchStoredReceipt(prev).catch(() => null))?.receipt.receipt_hash === prev;
  return {
    ...out,
    chain: `receipt store github.com/${receiptsRepo()}`,
    chain_linkage: held ? "verified" : "unverified",
    chain_id: f.r.chain_id ?? null,
    continuity: held
      ? "Read back from the durable receipt store; its predecessor is stored too, so the link was checked after the server that issued it was gone."
      : "Read back from the durable receipt store; its predecessor is not there, so only the receipt's own hash and band were checked.",
  };
}

/**
 * Hash recomputation + chain link: the receipt must hash to itself, and (if known) follow its predecessor.
 * Live-ledger receipts also report their epoch (chain_id): continuity can be checked only within the epoch this server
 * holds, and the answer says so instead of implying an unbroken history across redeploys.
 */
type VerifyOut = {
  valid: boolean;
  errors: string[];
  chain: string;
  /** how the receipt reached us: looked up by id, or handed over as its payload */
  source?: "id" | "payload";
  /** "verified" only when a ledger on this server holds the predecessor and the link was checked */
  chain_linkage?: "verified" | "unverified";
  chain_id?: string | null;
  chain_started_at?: string;
  continuity?: string;
  policy_version?: string;
  band_rederived?: string | null;
  band_matches?: boolean | null;
  policy_note?: string;
};

/**
 * Re-derive a receipt's band under the policy version it was issued with, never under today's rules.
 * v5 receipts carry their basis; census receipts (v4) are re-derived from the committed census data under v4 rules.
 */
function rederive(r: Receipt): Pick<VerifyOut, "policy_version" | "band_rederived" | "band_matches" | "policy_note"> {
  const version = r.policy_version ?? POLICY_V4;
  if (r.band_basis) {
    const band = bandFromBasis(r.band_basis);
    return { policy_version: version, band_rederived: band, band_matches: band === r.band, policy_note: `Issued under policy ${version}; the band is the lowest of the score, model, vow and cap bands recorded on the receipt.` };
  }
  const cp = legacyCensus().payees.find((p) => p.receipt_id === r.receipt_hash);
  if (cp)
    return {
      policy_version: version,
      band_rederived: cp.issued_band,
      band_matches: cp.issued_band === r.band,
      policy_note: `Issued under policy ${version}, before band caps existed; re-derived from the committed census data under that version. Today's answer for this payee may differ (see /v1/preview), but this receipt keeps its original band.`,
    };
  return { policy_version: version, band_rederived: null, band_matches: null, policy_note: `Issued under policy ${version}; the signals behind it are not retained, so the band cannot be re-derived. The hash still proves the receipt is unchanged.` };
}

function verifyOne(obj: unknown, source: "id" | "payload" = "id"): VerifyOut {
  const out = { source, ...verifyOneHash(obj) };
  if (!out.valid) return out;
  const d = rederive(obj as Receipt);
  if (d.band_matches === false) return { ...out, ...d, valid: false, errors: [`band ${(obj as Receipt).band} does not follow from its own policy (${d.band_rederived} expected)`] };
  return { ...out, ...d };
}

function verifyOneHash(obj: unknown): VerifyOut {
  const v = verifyReceipt(obj);
  if (!v.ok) return { valid: false, errors: v.errors, chain: "n/a", chain_linkage: "unverified" };
  const r = obj as Receipt;
  const known = findReceipt(r.receipt_hash);
  const epoch = existsSync(ledgerPath()) ? currentEpoch() : null;
  if (!known) {
    const other = r.chain_id && r.chain_id !== epoch?.chain_id;
    // a payload alone proves its own hash and band; it cannot prove the link to a predecessor this server does not hold
    return {
      valid: true,
      errors: [],
      chain: other ? "an earlier ledger epoch (hash self-consistent)" : "not in a known ledger (hash self-consistent)",
      chain_linkage: "unverified",
      chain_id: r.chain_id ?? null,
      continuity: "This receipt is internally consistent and its band re-derives. The link to the previous receipt cannot be checked because the ledger that held it is not on this server. Keep the payload; that is the durable part.",
    };
  }
  const i = known.list.findIndex((x) => x.receipt_hash === r.receipt_hash);
  // the first receipt of this process links to the durable store's HEAD when there is one (a redeploy continues the chain)
  const prev = i <= 0 ? (known.chain === "ledger" ? ledgerBaseHash() : "genesis") : known.list[i - 1]!.receipt_hash;
  if (r.prev_hash !== prev) return { valid: false, errors: [`prev_hash ${r.prev_hash} does not link to ${prev}`], chain: known.chain, chain_linkage: "unverified" };
  if (known.chain === "census") return { valid: true, errors: [], chain: `census #${i}`, chain_linkage: "verified", chain_id: null, continuity: "The census chain is rebuilt identically from committed data on every start, so it never resets." };
  return {
    valid: true,
    errors: [],
    chain: `ledger #${i}`,
    chain_linkage: "verified",
    chain_id: r.chain_id ?? null,
    chain_started_at: epoch?.started_at,
    continuity:
      epoch?.durability === "durable"
        ? "Continuous since this epoch started."
        : "Continuous since this epoch started. This server's ledger resets when it is redeployed; a new epoch then starts with a new chain_id. A receipt never depends on it: hash and band are verifiable from the receipt itself.",
  };
}

type Paid = { ok: true; requirement: Requirement; from: string | null; payload: unknown };
function requirePayment(req: IncomingMessage, res: ServerResponse, resource: string, usd: number, description: string): Paid | null {
  const seller = sellerPayTo();
  if (!seller.ok) {
    json(res, 503, { error: seller.error });
    return null;
  }
  const pr = paymentRequired(resource, usd, seller.payTo, description);
  const requirement = pr.body.accepts[0]!;
  // x402 v2 clients send PAYMENT-SIGNATURE; earlier clients send X-PAYMENT. Same base64 JSON payment either way.
  const header = req.headers["payment-signature"] ?? req.headers["x-payment"];
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
  return { ok: true, requirement, from: chk.from, payload: chk.payload };
}

/**
 * Live settlement (FIANGSHI_SETTLE=live): the facilitator checks the payer's signature before any work is done. A check
 * that fails is a 402 with the facilitator's reason. Dry-run (default): nothing is sent anywhere.
 */
async function verifyLive(pay: Paid, res: ServerResponse, retry: { body: unknown; header: string }): Promise<boolean> {
  if (settleMode() !== "live") return true;
  const ready = settleReady();
  if (!ready.ok) {
    json(res, 503, { error: `live settlement is not configured: ${ready.why}` });
    return false;
  }
  const v = await facilitatorVerify(pay.payload, pay.requirement).catch((e: Error) => ({ isValid: false, invalidReason: "facilitator_unreachable", invalidMessage: e.message }) as const);
  if (v.isValid) return true;
  json(res, 402, { ...(retry.body as object), error: `payment not valid: ${v.invalidReason ?? "unknown"}${v.invalidMessage ? ` (${v.invalidMessage})` : ""}` }, { "payment-required": retry.header });
  return false;
}

/**
 * Live settlement, after the work: the facilitator submits the payer's transfer. Only a settled payment is answered; a
 * failed settlement is a 402 carrying the facilitator's SettlementResponse, and no result is delivered.
 */
async function settleLive(pay: Paid, res: ServerResponse): Promise<{ tx: string; header: string } | null | false> {
  if (settleMode() !== "live") return null;
  const s = await facilitatorSettle(pay.payload, pay.requirement).catch((e: Error) => ({ success: false, errorReason: "facilitator_unreachable", errorMessage: e.message, transaction: "", network: pay.requirement.network }) as const);
  const header = Buffer.from(JSON.stringify(s)).toString("base64");
  if (s.success && isTxHash(s.transaction)) return { tx: s.transaction, header };
  json(res, 402, { error: `payment not settled: ${s.errorReason ?? "no transaction returned"}`, settlement: s }, { "payment-response": header, "x-payment-response": header });
  return false;
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = new URL(req.url ?? "/", "http://localhost");
  // language prefix for the HTML pages: /zh, /ja, /ko (no cookie, no script); English has none
  const lm = /^\/(zh|ja|ko)(?=\/|$)/.exec(u.pathname);
  setLang(lm ? (lm[1] as Lang) : "en");
  if (lm) u.pathname = u.pathname.slice(lm[0].length) || "/";
  setPagePath(u.pathname + u.search);
  const c = loadCensus();
  // behind a hosting proxy the public scheme arrives in x-forwarded-proto; links we hand out must use it
  const https = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]!.trim() === "https";
  const self = `${https ? "https" : "http"}://${req.headers.host ?? "127.0.0.1"}`;
  try {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    if (u.pathname === "/") return html(res, 200, renderIndex(c, loadDemoStats(), { tour: !tourDone(req) || u.searchParams.get("tour") === "1" }));
    if (u.pathname === "/tour/done") {
      // Closing the tour sets the one functional cookie, then returns to the page asked for, in the same language.
      let next = safeNext(u.searchParams.get("next"));
      if (lang() !== "en" && !next.startsWith(`/${lang()}/`) && next !== `/${lang()}`) next = next === "/" ? `/${lang()}` : `/${lang()}${next}`;
      res.writeHead(303, { location: next, "set-cookie": `${TOUR_COOKIE}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`, "cache-control": "no-store" });
      return void res.end();
    }
    if (ASSETS[u.pathname]) {
      // brand images, by exact name only (no path is ever built from the request)
      res.writeHead(200, { "content-type": ASSETS[u.pathname]!.type, "cache-control": "max-age=3600", "x-content-type-options": "nosniff", "x-fiangshi-mode": providerMode() });
      return void res.end(readFileSync(join(ROOT, "assets", ASSETS[u.pathname]!.file)));
    }
    if (u.pathname === "/docs" || u.pathname === "/docs/") return html(res, 200, renderDocsHome(c, loadDemoStats()));
    if (u.pathname === "/judges" || u.pathname === "/judges/") return html(res, 200, renderJudges(c, loadDemoStats()), true);
    const doc = docByPath(u.pathname);
    if (doc) return html(res, 200, renderDoc(doc.kind, c, loadDemoStats()));
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
      const f = await lookupReceipt(hm[1]!);
      return f ? html(res, 200, renderReceipt(f.r, await verifyFound(f), c, self, loadDemoStats())) : html(res, 404, renderNotFound("No receipt with that id.", c, loadDemoStats()));
    }
    if (u.pathname === "/v1/preview") {
      // Free JSON twin of the /check page, for agents and the MCP server: one unpaid probe, the null-payee gate and the
      // census answer. Never a model call, never a Surf call. A full verdict on a live probe is the paid /v1/check.
      const input = (u.searchParams.get("url") ?? "").trim();
      if (!/^https?:\/\/\S{1,2000}$/i.test(input)) return json(res, 400, { error: "pass ?url=<an http or https x402 endpoint>" });
      const pr = await probe(input);
      const seller = sellerPayTo();
      const paid: PaidStatus = seller.ok ? { ok: true, url: `${self}/v1/check?url=${encodeURIComponent(input)}` } : { ok: false, why: "the operator has not set a receiving wallet (FIANGSHI_PAYTO), so the paid route answers 503" };
      if (!pr.ok) return json(res, 200, noVerdictAnswer(input, pr.error, paid));
      const terms = { price_usd: pr.terms.price, network: pr.terms.network, asset: pr.terms.asset, pay_to: pr.payTo_raw, terms_hash: pr.terms.terms_hash };
      if (v6({ payTo: pr.payTo_raw, asset: pr.terms.asset }).band === "BLOCK") {
        const r = await check(input, { probe: pr });
        return json(res, 200, nullPayeeAnswer(input, terms, r.decision.verdict.citations[0]?.quote ?? "null payee", r.receipt.receipt_hash));
      }
      const cp = c.payees.find((x) => x.payee === pr.terms.payee);
      return json(res, 200, cp ? censusAnswer(input, terms, c, cp, paid) : noRecordAnswer(input, terms, c, paid));
    }
    if (u.pathname === "/openapi.json") {
      // raw, not through json(): OpenAPI allows only x- extensions at the root, so no mode/provenance keys here
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=300", "access-control-allow-origin": "*", "x-fiangshi-mode": providerMode() });
      return void res.end(JSON.stringify(openapi(self), null, 2));
    }
    if (u.pathname === "/v1/census/status") return json(res, 200, censusStatus(c, readRuns(), nowMs()));
    if (u.pathname === "/health") return json(res, 200, { ok: true, census_payees: c.payees.length, census_at: c.at, settlement: settleReady().ok ? "live: CDP x402 facilitator (payer -> payTo, Fiangshi never holds funds)" : currentSettlement(), ledger_durability: ledgerDurability() });
    if (u.pathname === "/v1/index.json")
      return json(res, 200, {
        census_at: c.at,
        policy_version: POLICY_VERSION,
        served_at: c.served_at,
        stale_limit_hours: c.stale_limit_hours,
        payees_total: c.payees.length,
        payees_stale: c.payees_stale,
        oldest_as_of: c.oldest_as_of,
        newest_as_of: c.newest_as_of,
        window_days: c.window_days,
        coverage: `${c.payees.length} of ${c.catalog_payees} Base payees`,
        bands: c.bands,
        chain: "eip155:8453",
        payees: c.payees.map((p) => ({ chain: p.chain, payee: p.payee, url: p.url, band: p.band, issued_band: p.issued_band, band_cap: p.band_cap, verdict_confidence: p.verdict_confidence, score: p.score, vows: p.vows, as_of: p.as_of, data_age_hours: p.data_age_hours, stale: p.stale, receipt_id: p.receipt_id })),
      });
    let m = /^\/v1\/badge\/(0x[0-9a-fA-F]{40})\.svg$/.exec(u.pathname);
    if (m) {
      const p = c.payees.find((x) => x.payee === m![1]!.toLowerCase());
      res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "max-age=300", "x-fiangshi-mode": providerMode() });
      return void res.end(badgeSvg(p?.band ?? null, p?.score ?? null));
    }
    m = /^\/v1\/receipt\/([0-9a-f]{64})$/.exec(u.pathname);
    if (m) {
      const f = await lookupReceipt(m[1]!);
      return f ? json(res, 200, { chain: f.source, receipt: f.r }) : json(res, 404, UNKNOWN_ID);
    }
    m = /^\/v1\/receipts\/([0-9a-f]{64})$/.exec(u.pathname);
    if (m) {
      // the stored receipt, wherever it lives (census, this process's ledger, or the durable store), with its verify result
      const f = await lookupReceipt(m[1]!);
      return f ? json(res, 200, { id: m[1], source: f.source, receipt: f.r, verify: await verifyFound(f) }) : json(res, 404, { id: m[1], ...UNKNOWN_ID });
    }
    if (u.pathname === "/v1/verify") {
      const id = u.searchParams.get("id");
      const raw = u.searchParams.get("receipt");
      if (raw) {
        const d = decodeReceiptParam(raw);
        if (!d.ok) return json(res, d.error.includes("larger than") ? 413 : 200, { source: "payload", valid: false, errors: [d.error] });
        const rid = (d.obj as { receipt_hash?: unknown } | null)?.receipt_hash;
        return json(res, 200, { id: typeof rid === "string" ? rid : null, ...verifyOne(d.obj, "payload") });
      }
      if (id) {
        const f = await lookupReceipt(id);
        return f ? json(res, 200, { id, ...(await verifyFound(f)) }) : json(res, 404, { id, source: "id", valid: false, ...UNKNOWN_ID });
      }
      return json(res, 400, { error: "pass ?id=<receipt id> or ?receipt=<base64url receipt JSON>" });
    }
    m = /^\/v1\/payee\/(0x[0-9a-fA-F]{40})$/.exec(u.pathname);
    if (m) {
      const resource = `${self}${u.pathname}`;
      const usd = num("FIANGSHI_PRICE_PAYEE", 0.02);
      const pay = requirePayment(req, res, resource, usd, "Fiangshi payee record");
      if (!pay) return;
      const p = c.payees.find((x) => x.payee === m![1]!.toLowerCase());
      // live: never charge for a record that does not exist; verify and settle only when there is one to deliver
      if (p) {
        const t = paymentRequired(resource, usd, pay.requirement.payTo, "Fiangshi payee record");
        if (!(await verifyLive(pay, res, { body: t.body, header: t.header }))) return;
      }
      const settled = p ? await settleLive(pay, res) : null;
      if (settled === false) return;
      const st = settled ? { settlement: "settled", tx_hash: settled.tx } : { settlement: "dry-run" };
      return json(res, p ? 200 : 404, p ? { ...p, ...freshness(p.as_of), ...st, payer: pay.from, receipt_id: p.receipt_id } : { error: "payee not in the census", settlement: "dry-run" }, settled ? { "payment-response": settled.header, "x-payment-response": settled.header } : { "x-payment-response": paymentResponse(pay.requirement.network, pay.from) });
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
        return json(res, 200, { band: r.decision.verdict.band, vow_fired: r.decision.verdict.vow_fired ?? null, vows_fired: r.decision.vows.filter((v) => v.fired).map((v) => v.vow), reason: r.decision.verdict.citations[0]?.quote, cost_usd: 0, model_calls: modelCalls.length - mc0, receipt_id: r.receipt.receipt_hash, receipt: r.receipt, receipt_verify_url: receiptVerifyUrl(self, r.receipt), settlement: "dry-run", ms: Math.round(performance.now() - t0) }, { "x-receipt-verify": receiptVerifyUrl(self, r.receipt) });
      }
      // Cached SKU: a census payee or a cold payee fetched in the last 72 h. Cold SKU: anyone else, fetched live from Surf.
      const terms = pr.ok ? pr.terms : null;
      const payee = terms?.payee ?? "unknown";
      const cp = c.payees.find((x) => x.payee === payee);
      const coldLive = providerMode() === "live";
      const cachedCold = !cp && terms ? coldCacheHit(payee) : false;
      const sku: "cached" | "cold" = cp || cachedCold || !terms || !coldLive ? "cached" : "cold";
      const price = sku === "cold" ? num("FIANGSHI_PRICE_CHECK_COLD", 0.15) : num("FIANGSHI_PRICE_CHECK", 0.05);
      const desc = sku === "cold" ? "Fiangshi counterparty check (cold: live on-chain fetch)" : "Fiangshi counterparty check";
      const resource = `${self}/v1/check?url=${encodeURIComponent(target)}`;
      const pay = requirePayment(req, res, resource, price, desc);
      if (!pay) return;
      const terms402 = paymentRequired(resource, price, pay.requirement.payTo, desc);
      if (!(await verifyLive(pay, res, { body: terms402.body, header: terms402.header }))) return;
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
      // policy v5: the record's own collection time decides the stale cap (census record, or the cold fetch just made)
      const asOf = cp ? cp.as_of : ((cold?.fetched_at as string | undefined) ?? new Date(nowMs()).toISOString());
      const v5 = v5Fields(d, asOf, nowMs(), staleHours());
      const coldNote = cold && cold.ok === false ? [{ signal: "cold_check", quote: `${String(cold.reason)}: ${String(cold.detail)}` }] : [];
      const settled = await settleLive(pay, res);
      if (settled === false) return;
      const receipt = appendReceipt({
        payee,
        url: target,
        terms_hash: terms?.terms_hash ?? hashOf({ url: target, probe_error: pr.ok ? null : pr.error }),
        price: terms?.price ?? null,
        band: v5.band,
        score: d.verdict.score,
        vow_fired: d.verdict.vow_fired ?? null,
        evidence: [...d.verdict.citations, ...coldNote],
        model: { verdict: d.modelRawBand, extractor: full.extraction ? (full.extraction.claims ? "dolphin" : "dolphin:failed") : "none", degraded: d.verdict.degraded },
        snapshot_id: cp ? hashOf({ census: "w90", at: c.at }) : hashOf({ cold: payee, fetched_at: (cold?.fetched_at as string | undefined) ?? null }),
        checked_at: new Date().toISOString(),
        settlement: settled ? "settled" : currentSettlement(),
        ...(settled ? { tx_hash: settled.tx, chain: "eip155:8453" as const } : {}),
        enrichment: full.enrichment,
        ...v5.fields,
      });
      return json(res, 200, {
        band: v5.band,
        band_cap: v5.cap.band_cap,
        verdict_confidence: v5.cap.verdict_confidence,
        policy_version: v5.fields.policy_version,
        ...freshness(asOf),
        score: d.verdict.score,
        vow_fired: d.verdict.vow_fired ?? null,
        vows_fired: d.vows.filter((v) => v.fired).map((v) => v.vow),
        vows: d.vows.filter((v) => v.fired).map((v) => ({ vow: v.vow, band: v.band, reason: v.reason, ...(v.flags ? { flags: v.flags } : {}) })),
        model: { serv: d.modelRawBand, degraded: d.verdict.degraded },
        enrichment: full.enrichment,
        in_census: Boolean(cp),
        sku,
        cold,
        probe: pr.ok ? { price: pr.terms.price, payee: pr.terms.payee } : { error: pr.error },
        cost_usd: price,
        payer: pay.from,
        settlement: settled ? "settled" : "dry-run",
        ...(settled ? { tx_hash: settled.tx } : {}),
        model_calls: modelCalls.length - mc0,
        receipt_id: receipt.receipt_hash,
        receipt,
        receipt_verify_url: receiptVerifyUrl(self, receipt),
        ms: Math.round(performance.now() - t0),
      }, { ...(settled ? { "payment-response": settled.header, "x-payment-response": settled.header } : { "x-payment-response": paymentResponse(pay.requirement.network, pay.from) }), "x-receipt-verify": receiptVerifyUrl(self, receipt) });
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    // a reply already under way cannot get a second status line: end it instead of crashing the server
    if (res.headersSent) return void res.end();
    return json(res, 500, { error: (e as Error).message.slice(0, 300) });
  }
}

export async function startServer(port = num("PORT", 8787), host = process.env.HOST ?? "127.0.0.1") {
  if (process.env.FIANGSHI_REPLAY === "1") process.env.FIANGSHI_OFFLINE = "1"; // fixture mode: recorded 402s, never the network
  if (process.env.FIANGSHI_OFFLINE !== "1") process.env.SNAPSHOT_SOURCE = "live"; // probe live endpoints
  process.env.MOCK_MODELS ??= "";
  loadCensus(); // fail fast if fixtures are missing
  const rs = restoreFromMirror(); // a mirror, if configured, is loaded before the first request
  if (rs) process.stdout.write(`ledger restored: ${rs.entries} entries, chain ${rs.intact} intact${rs.refused ? `, ${rs.refused} refused` : ""}\n`);
  const head = await restoreFromGithub(); // the durable store's newest receipt: this process continues its chain
  if (githubStoreOn()) process.stdout.write(`receipt store: github.com/${receiptsRepo()}, ${head ? `HEAD ${head.receipt_hash.slice(0, 12)} (#${head.count})` : "empty"}\n`);
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
  // --port N and --host H override PORT / HOST; a hosting platform sets PORT and needs --host 0.0.0.0 (npm start)
  const arg = (k: string) => (process.argv.indexOf(k) > 0 ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  const port = Number(arg("--port")) > 0 ? Number(arg("--port")) : num("PORT", 8787);
  const s = await startServer(port, arg("--host") ?? process.env.HOST ?? "127.0.0.1");
  const a = s.address();
  console.log(`fiangshi listening on http://${typeof a === "object" && a ? `${a.address}:${a.port}` : a} (providers: ${providerMode()})`);
}
