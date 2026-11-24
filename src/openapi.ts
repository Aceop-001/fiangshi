/**
 * GET /openapi.json (2026-11-24): an OpenAPI 3.1 description of every route the API answers. Hand-written (zod 3 has no
 * JSON Schema export, and no new dependency was added); tests/openapi.test.ts keeps it honest: the Receipt schema must
 * list exactly the fields of the zod Receipt, and every documented JSON route's real response must carry the documented
 * required fields and nothing undocumented.
 */
const str = { type: "string" } as const;
const num = { type: "number" } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;
const nullable = (t: object) => ({ anyOf: [t, { type: "null" }] });
const hex64 = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const band = { type: "string", enum: ["ALLOW", "REVIEW", "BLOCK"] } as const;
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema: object, description = "OK") => ({ description, content: { "application/json": { schema } } });
const obj = (properties: Record<string, object>, required: string[] = [], additional = false) => ({ type: "object", properties, required, additionalProperties: additional });

export const RECEIPT_FIELDS = [
  "payee", "url", "terms_hash", "price", "band", "score", "vow_fired", "evidence", "model", "snapshot_id", "checked_at", "prev_hash", "receipt_hash",
  "settlement", "tx_hash", "fee_usd", "enrichment", "chain", "chain_id", "policy_version", "as_of", "band_cap", "band_basis",
] as const;

const receipt = obj(
  {
    payee: str,
    url: str,
    terms_hash: hex64,
    price: nullable(num),
    band,
    score: num,
    vow_fired: nullable(str),
    evidence: { type: "array", items: obj({ signal: str, quote: str }, ["signal", "quote"]) },
    model: obj({ verdict: nullable(band), extractor: str, degraded: bool }, ["verdict", "extractor", "degraded"]),
    snapshot_id: hex64,
    checked_at: { type: "string", format: "date-time" },
    prev_hash: { anyOf: [hex64, { const: "genesis" }] },
    receipt_hash: { ...hex64, description: "sha256 of the canonical JSON of every other field" },
    settlement: { anyOf: [{ enum: ["dry-run", "settled"] }, { type: "string", pattern: "^kite:.+" }] },
    tx_hash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "with settlement \"settled\": the Base transaction that moved the payment" },
    fee_usd: { type: "number", minimum: 0, description: "what the agent was charged for this check, in USD (the seller's own price is `price`)" },
    enrichment: obj({ status: { enum: ["complete", "incomplete", "skipped"] }, reason: nullable(str) }, ["status", "reason"]),
    chain: { const: "eip155:8453" },
    chain_id: hex64,
    policy_version: str,
    as_of: str,
    band_cap: { type: "object", description: "set when the record's age capped the band (data_stale)" },
    band_basis: { type: "object", description: "score, model, vow and cap bands; the receipt's band is the lowest" },
  },
  ["payee", "url", "terms_hash", "price", "band", "score", "vow_fired", "evidence", "model", "snapshot_id", "checked_at", "prev_hash", "receipt_hash", "settlement"],
);

const verify = obj(
  {
    id: nullable(str),
    source: { enum: ["id", "payload"] },
    valid: bool,
    errors: { type: "array", items: str },
    chain: str,
    chain_linkage: { enum: ["verified", "unverified"] },
    chain_id: nullable(str),
    chain_started_at: str,
    continuity: str,
    policy_version: str,
    band_rederived: nullable(band),
    band_matches: nullable(bool),
    policy_note: str,
    mode: str,
    provenance: str,
    error: str,
    hint: str,
  },
  ["valid"],
);

const paymentRequired = obj(
  {
    x402Version: { const: 2 },
    error: str,
    resource: obj({ url: str, description: str, mimeType: str }),
    accepts: {
      type: "array",
      items: obj({ scheme: { const: "exact" }, network: { const: "eip155:8453" }, amount: { type: "string", pattern: "^\\d+$" }, asset: str, payTo: str, maxTimeoutSeconds: int, extra: { type: "object" } }, ["scheme", "network", "amount", "asset", "payTo"]),
    },
    mode: str,
    provenance: str,
  },
  ["x402Version", "accepts"],
);

const x402 = {
  "402": { description: "Payment required: x402 v2 terms in the body and, base64, in the PAYMENT-REQUIRED header.", headers: { "payment-required": { schema: str } }, content: { "application/json": { schema: ref("PaymentRequired") } } },
  "503": json(obj({ error: str }, ["error"], true), "Payments are not configured on this server"),
};
const payHeaders = [
  { name: "payment-signature", in: "header", required: false, schema: str, description: "x402 v2 payment: base64 JSON PaymentPayload (EIP-3009 authorization). X-PAYMENT is accepted too." },
  { name: "x-payment", in: "header", required: false, schema: str, description: "The same payment, under the earlier header name." },
];
const idParam = { name: "id", in: "path", required: true, schema: hex64 };

export function openapi(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Fiangshi",
      version: "2026-11-24",
      summary: "Pre-payment counterparty checks for x402 agent payments on Base.",
      description: "Advisory only. Fiangshi never holds funds or signs transactions. Paid routes use x402 v2 (USDC on Base, eip155:8453); settlement is dry-run unless the operator turns live settlement on, and /health says which.",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/health": { get: { summary: "Liveness, census time, settlement mode, ledger durability", responses: { "200": json(ref("Health")) } } },
      "/openapi.json": { get: { summary: "This document", responses: { "200": json({ type: "object" }) } } },
      "/v1/index.json": { get: { summary: "Every census payee with band, score and receipt id (free)", responses: { "200": json(ref("Index")) } } },
      "/v1/census/status": { get: { summary: "Freshness now, the last refresh, the next planned one (free)", responses: { "200": json(ref("CensusStatus")) } } },
      "/v1/preview": {
        get: {
          summary: "Free check: one unpaid probe, the null-payee gate and the census answer; no model call",
          parameters: [{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } }],
          responses: { "200": json(ref("Preview")), "400": json(obj({ error: str }, ["error"], true), "Missing or invalid url") },
        },
      },
      "/v1/check": {
        get: {
          summary: "Paid verdict ($0.05 cached, $0.15 cold) with a sealed receipt. A null payee is BLOCKed free, before any payment.",
          parameters: [{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } }, ...payHeaders],
          responses: { "200": json(ref("CheckResult")), ...x402, "400": json(obj({ error: str }, ["error"], true), "Missing or invalid url") },
        },
      },
      "/v1/batch": {
        get: {
          summary: "Up to 10 checks under one x402 payment, 20% off their summed prices; one receipt per check, null payees free",
          parameters: [{ name: "url", in: "query", required: true, style: "form", explode: true, schema: { type: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "string", format: "uri" } } }, ...payHeaders],
          responses: { "200": json(ref("BatchResult")), ...x402, "400": json(obj({ error: str }, ["error"], true), "No url, more than 10, a duplicate, or not http(s)") },
        },
      },
      "/v1/stats": { get: { summary: "Checks served and USD settled in the last 24 h, from sealed receipts (free)", responses: { "200": json(ref("Stats")) } } },
      "/v1/payee/{address}": {
        get: {
          summary: "Paid census record for one payee ($0.02)",
          parameters: [{ name: "address", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, ...payHeaders],
          responses: { "200": json({ type: "object" }), "404": json(obj({ error: str, settlement: str }, ["error"], true), "Not in the census"), ...x402 },
        },
      },
      "/v1/receipt/{id}": { get: { summary: "A receipt by id: census, live ledger, or the durable store", parameters: [idParam], responses: { "200": json(obj({ chain: str, receipt: ref("Receipt"), mode: str, provenance: str }, ["chain", "receipt"])), "404": json(obj({ error: str, hint: str }, ["error"], true), "Unknown id") } } },
      "/v1/receipts/{id}": { get: { summary: "The stored receipt with its verify result", parameters: [idParam], responses: { "200": json(obj({ id: hex64, source: { enum: ["census", "ledger", "store"] }, receipt: ref("Receipt"), verify: ref("Verify"), mode: str, provenance: str }, ["id", "source", "receipt", "verify"])), "404": json(obj({ id: str, error: str, hint: str }, ["error"], true), "Unknown id") } } },
      "/v1/verify": {
        get: {
          summary: "Recompute a receipt's hash, re-derive its band, check its chain link",
          parameters: [
            { name: "id", in: "query", required: false, schema: hex64 },
            { name: "receipt", in: "query", required: false, schema: str, description: "base64url (optionally gzip) receipt JSON: verify without this server's ledger" },
          ],
          responses: { "200": json(ref("Verify")), "400": json(obj({ error: str }, ["error"], true), "Neither id nor receipt"), "404": json(ref("Verify"), "Unknown id"), "413": json(ref("Verify"), "Receipt too large") },
        },
      },
      "/v1/badge/{file}": { get: { summary: "An SVG badge coloured by the payee's band", parameters: [{ name: "file", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}\\.svg$" } }], responses: { "200": { description: "SVG", content: { "image/svg+xml": { schema: str } } } } } },
      "/": { get: { summary: "The site (static HTML, no script)", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/check": { get: { summary: "The free check as a page", parameters: [{ name: "url", in: "query", required: false, schema: str }], responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } }, "400": { description: "HTML: no url, or not an http(s) url", content: { "text/html": { schema: str } } } } } },
      "/docs": { get: { summary: "Documentation home", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/judges": { get: { summary: "For judges", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/guide": { get: { summary: "Guide", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/connect": { get: { summary: "Connect your AI", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/cli": { get: { summary: "CLI and agent skill", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/pricing": { get: { summary: "Pricing", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/architecture": { get: { summary: "Architecture", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/report": { get: { summary: "Test report", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/legal": { get: { summary: "Legal", responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } } } } },
      "/receipt/{id}": { get: { summary: "A receipt as a page, with its verification", parameters: [idParam], responses: { "200": { description: "HTML", content: { "text/html": { schema: str } } }, "404": { description: "HTML", content: { "text/html": { schema: str } } } } } },
    },
    components: {
      schemas: {
        Receipt: receipt,
        Verify: verify,
        PaymentRequired: paymentRequired,
        Health: obj({ ok: bool, census_payees: int, census_at: str, settlement: str, ledger_durability: str, mode: str, provenance: str }, ["ok", "census_payees", "census_at", "settlement", "ledger_durability"]),
        CensusStatus: obj(
          { census_at: str, served_at: str, records_total: int, records_stale: int, stale_limit_hours: num, allow_issued: int, allow_served: int, allow_capped: int, refresh_interval_hours: num, next_refresh_at: str, overdue: bool, last_run: nullable(obj({ at: str, kind: str, credits_spent: nullable(num), payees_refreshed: int, payees_failed: int }, ["at", "kind", "credits_spent", "payees_refreshed", "payees_failed"])), note: str, mode: str, provenance: str },
          ["census_at", "records_total", "records_stale", "next_refresh_at", "last_run"],
        ),
        Index: obj(
          { census_at: str, policy_version: str, served_at: str, stale_limit_hours: num, payees_total: int, payees_stale: int, oldest_as_of: str, newest_as_of: str, window_days: int, coverage: str, bands: obj({ ALLOW: int, REVIEW: int, BLOCK: int }, ["ALLOW", "REVIEW", "BLOCK"]), chain: str, payees: { type: "array", items: { type: "object" } }, mode: str, provenance: str },
          ["census_at", "payees_total", "payees_stale", "bands", "payees"],
        ),
        Preview: { type: "object", description: "One schema on every path; `class` is VERDICT, NO_RECORD, PAYMENT_TERMS_UNPARSEABLE or UNVERIFIED_ENDPOINT", properties: { url: str, verdict: str, class: str, model_calls: { const: 0 } } },
        BatchResult: obj({ items: { type: "array", items: { type: "object" } }, count: int, list_price_usd: num, discount: num, cost_usd: num, payer: nullable(str), settlement: { enum: ["dry-run", "settled"] }, tx_hash: str, model_calls: int, ms: int, mode: str, provenance: str }, ["items", "count", "cost_usd", "settlement"]),
        Stats: obj({ window_hours: int, counted_since: str, checks_served_24h: int, paid_checks_24h: int, settled_checks_24h: int, usd_settled_24h: num, usd_charged_dry_run_24h: num, free_previews_24h: int, settlement_mode: str, settled_tx: { type: "array", items: str }, note: str, mode: str, provenance: str }, ["checks_served_24h", "usd_settled_24h", "settlement_mode"]),
        CheckResult: { type: "object", properties: { band, score: num, settlement: { enum: ["dry-run", "settled"] }, tx_hash: str, receipt_id: hex64, receipt: ref("Receipt"), receipt_verify_url: str, cost_usd: num, model_calls: int, payer: nullable(str) }, required: ["band", "settlement", "receipt_id", "receipt"] },
      },
    },
  };
}
