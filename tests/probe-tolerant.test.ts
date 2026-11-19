// Workstream A (post-deadline): every wire format a 402 may carry its terms in, and a structured record when none does.
import { describe, it, expect } from "vitest";
import { parse402 } from "../src/adapters/probe.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // EIP-55 example vector
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const REQ = { scheme: "exact", network: "eip155:8453", amount: "10000", payTo: PAYTO, asset: USDC };
const V2 = { x402Version: 2, accepts: [REQ] };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const r402 = (headers: Record<string, string>, body: unknown = "") => ({ url: "https://seller.example/paid", status: 402, headers, body });

function expectTerms(r: ReturnType<typeof parse402>, label: string) {
  expect(r.ok, label).toBe(true);
  if (!r.ok) return;
  expect(r.terms.price, label).toBe(0.01);
  expect(r.terms.network, label).toBe("base");
  expect(r.payTo_raw, label).toBe(PAYTO);
}

describe("parse402: tolerant of where the terms arrive", () => {
  it("payment-required header, base64 JSON (the existing v2 path)", () => expectTerms(parse402(r402({ "payment-required": b64(V2) })), "b64"));
  it("payment-required header, raw JSON", () => expectTerms(parse402(r402({ "Payment-Required": JSON.stringify(V2) })), "raw"));
  it("x-payment-required header, raw or base64", () => {
    expectTerms(parse402(r402({ "x-payment-required": JSON.stringify(V2) })), "x raw");
    expectTerms(parse402(r402({ "X-Payment-Required": b64(V2) })), "x b64");
  });
  it("www-authenticate: token68 (base64 JSON) and auth-params", () => {
    expectTerms(parse402(r402({ "www-authenticate": `x402 ${b64(V2)}` })), "token68");
    expectTerms(parse402(r402({ "www-authenticate": `x402 payTo="${PAYTO}", amount="10000", network="eip155:8453", asset="${USDC}"` })), "params");
  });
  it("www-authenticate without a full requirement is not guessed into one", () => {
    const r = parse402(r402({ "www-authenticate": `x402 payTo="${PAYTO}", price="0.01"` }));
    expect(r.ok).toBe(false);
  });
  it("402 HTML page with terms in a <script type=application/json> block", () => {
    const page = `<!doctype html><html><body><h1>Pay first</h1><script type="application/json" id="x402">${JSON.stringify(V2)}</script></body></html>`;
    expectTerms(parse402(r402({ "content-type": "text/html" }, page)), "html");
  });
  it("non-standard bodies: accepts as one object, or x402Version missing", () => {
    expectTerms(parse402(r402({}, { x402Version: 2, accepts: REQ })), "object");
    expectTerms(parse402(r402({}, { accepts: [REQ] })), "no version");
  });
  it("the body still wins over headers, so recorded receipts keep the same terms", () => {
    const other = { ...REQ, amount: "20000" };
    const r = parse402(r402({ "payment-required": b64({ x402Version: 2, accepts: [other] }) }, V2));
    expect(r.ok && r.terms.price).toBe(0.01);
  });
});

describe("parse402: a 402 without terms is a structured record, not a bare error", () => {
  it("Vercel's own 402 (DEPLOYMENT_DISABLED, as served by repay-ready.vercel.app on 2026-11-19)", () => {
    const r = parse402(r402({ "content-type": "text/plain; charset=utf-8", "x-vercel-error": "DEPLOYMENT_DISABLED", "set-cookie": "s=secret" }, "Payment required\n\nDEPLOYMENT_DISABLED\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.class).toBe("PAYMENT_TERMS_UNPARSEABLE");
    expect(r.error).toMatch(/host-level 402 from Vercel \(DEPLOYMENT_DISABLED\)/);
    expect(r.headers?.["x-vercel-error"]).toBe("DEPLOYMENT_DISABLED");
    expect(r.headers?.["set-cookie"]).toBe("[redacted]");
  });
  it("any other 402 with no terms says where it looked", () => {
    const r = parse402(r402({ "content-type": "text/html" }, "<p>pay us</p>"));
    expect(!r.ok && r.class).toBe("PAYMENT_TERMS_UNPARSEABLE");
    expect(!r.ok && r.error).toMatch(/x-payment-required, www-authenticate and embedded JSON/);
  });
  it("a non-402 is NOT_402, so callers can tell it from an unparseable 402", () => {
    const r = parse402({ url: "u", status: 308, headers: { location: "https://www.example.com/" }, body: "" });
    expect(!r.ok && r.class).toBe("NOT_402");
  });
});
