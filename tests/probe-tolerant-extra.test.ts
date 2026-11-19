// G (post-deadline): the four extra shapes a 402 may carry its terms in, and the evidence record when none does.
import { describe, it, expect } from "vitest";
import { BODY_EXCERPT_BYTES, parse402, redactBody } from "../src/adapters/probe.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // EIP-55 example vector
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const REQ = { scheme: "exact", network: "eip155:8453", amount: "10000", payTo: PAYTO, asset: USDC };
const V2 = { x402Version: 2, accepts: [REQ] };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const r402 = (headers: Record<string, string>, body: unknown = "") => ({ url: "https://seller.example/paid", status: 402, headers, body });
const html = (inner: string) => `<!doctype html><html><head>${inner}</head><body><h1>Payment required</h1></body></html>`;

function expectTerms(r: ReturnType<typeof parse402>) {
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.terms.price).toBe(0.01);
  expect(r.terms.network).toBe("base");
  expect(r.terms.payee).toBe(PAYTO.toLowerCase());
  expect(r.payTo_raw).toBe(PAYTO);
}

describe("parse402: four more shapes, one normalized result", () => {
  it("1. X-PAYMENT-REQUIRED header, raw JSON and base64 JSON", () => {
    expectTerms(parse402(r402({ "X-PAYMENT-REQUIRED": JSON.stringify(V2) })));
    expectTerms(parse402(r402({ "X-PAYMENT-REQUIRED": b64(V2) })));
  });
  it("2. WWW-Authenticate, token68 and parameter form", () => {
    expectTerms(parse402(r402({ "WWW-Authenticate": `X402 ${b64(V2)}` })));
    expectTerms(parse402(r402({ "WWW-Authenticate": `x402 network="eip155:8453", payTo="${PAYTO}", maxAmountRequired="10000", asset="${USDC}"` })));
  });
  it("3. text/html 402 with <script type=\"application/json\">", () => {
    expectTerms(parse402(r402({ "content-type": "text/html" }, html(`<script id="terms" type="application/json">${JSON.stringify(V2)}</script>`))));
  });
  it("4a. <meta> tag (HTML-escaped JSON or base64 in content)", () => {
    expectTerms(parse402(r402({ "content-type": "text/html" }, html(`<meta name="x402" content="${esc(JSON.stringify(V2))}">`))));
    expectTerms(parse402(r402({ "content-type": "text/html" }, html(`<meta content='${b64(V2)}' property="payment-required" />`))));
  });
  it("4b. JSON-LD block with the terms nested inside an Offer", () => {
    const ld = { "@context": "https://schema.org", "@type": "Offer", name: "paid api", paymentTerms: V2 };
    expectTerms(parse402(r402({ "content-type": "text/html" }, html(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`))));
  });
  it("an unrelated meta tag is not read as terms", () => {
    const r = parse402(r402({ "content-type": "text/html" }, html(`<meta name="description" content="${esc(JSON.stringify(V2))}">`)));
    expect(r.ok).toBe(false);
  });
});

describe("parse402: when every shape fails, the record carries evidence", () => {
  it("all four fail: status, content type, headers seen, redacted 2 KB excerpt, every attempt; never throws", () => {
    const body = html(
      `<meta name="x402" content="not json"><script type="application/json">{"hello":1}</script>` +
        `<p>contact ops@seller.example, Authorization: Bearer abc.def.ghi</p>` + "x".repeat(5000),
    );
    const headers = { "content-type": "text/html; charset=utf-8", "X-Payment-Required": "%%%", "www-authenticate": `x402 realm="api"`, "set-cookie": "sid=1" };
    let r: ReturnType<typeof parse402> | undefined;
    expect(() => (r = parse402(r402(headers, body)))).not.toThrow();
    expect(r!.ok).toBe(false);
    if (r!.ok) return;
    expect(r!.class).toBe("PAYMENT_TERMS_UNPARSEABLE");
    const e = r!.evidence!;
    expect(e.status).toBe(402);
    expect(e.content_type).toBe("text/html; charset=utf-8");
    expect(e.headers_seen).toEqual(["content-type", "set-cookie", "www-authenticate", "x-payment-required"]);
    expect(Buffer.byteLength(e.body_excerpt, "utf8")).toBeLessThanOrEqual(BODY_EXCERPT_BYTES);
    expect(e.body_excerpt).toContain("[redacted-email]");
    expect(e.body_excerpt).toContain("Bearer [redacted]");
    expect(e.body_excerpt).not.toContain("ops@seller.example");
    expect(e.attempts).toEqual([
      "body: not JSON",
      "payment-required: absent",
      "x-payment-required: not JSON",
      "www-authenticate: no terms in token68 or params",
      "html <script> json: JSON without a valid x402 requirement",
      "json-ld nested: no nested accepts",
      "<meta>: no x402 meta tag with JSON content",
    ]);
    expect(r!.headers?.["set-cookie"]).toBe("[redacted]");
  });
  it("redactBody keeps payee addresses, removes keys and 32-byte hex", () => {
    const s = redactBody({ payTo: PAYTO, api_key: "sk_live_abcdefghijklmnop", privateKey: "0x" + "ab".repeat(32) });
    expect(s).toContain(PAYTO);
    expect(s).not.toContain("sk_live_abcdefghijklmnop");
    expect(s).not.toContain("ab".repeat(32));
  });
  it("a non-402 is still NOT_402, without an evidence record", () => {
    const r = parse402({ url: "https://x.example", status: 200, headers: {}, body: "" });
    expect(r.ok === false && r.class).toBe("NOT_402");
    expect(r.ok === false && r.evidence).toBeUndefined();
  });
});
