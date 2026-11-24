/**
 * x402 SELLER side for Fiangshi's own paid endpoints. Fiangshi never holds funds, signs, or sends transactions.
 * - paymentRequired(): an x402 v2 402 body (the same shape src/adapters/probe.ts parses) + base64 `payment-required` header.
 * - verifyXPayment(): STRUCTURAL validation of a payment header (x402 v2 `PAYMENT-SIGNATURE`, or `X-PAYMENT`; base64 JSON:
 *   x402Version, `accepted` terms or scheme/network, payload.authorization {from,to,value,validAfter,validBefore,nonce},
 *   payload.signature). It does not check the EIP-3009 signature itself (no secp256k1 without a new dependency).
 * - Settlement: "dry-run" by default. With FIANGSHI_SETTLE=live, src/adapters/facilitator.ts has the CDP x402 facilitator
 *   verify the signature before any work and settle after it (2026-11-24); the receipt then carries the tx hash.
 */
import { checksumValid, v6 } from "../core/v6.js";

export type SettlementTag = "dry-run" | `kite:${string}`;
export function currentSettlement(): SettlementTag {
  return "dry-run";
}

export const BASE_CAIP2 = "eip155:8453";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export interface Requirement {
  scheme: "exact";
  network: string;
  amount: string; // atomic USDC (6 decimals)
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
}

export const usdToAtomic = (usd: number) => String(Math.round(usd * 1e6));

/** The seller payTo: FIANGSHI_PAYTO, which must itself pass V6 (never a sink, never a bad checksum). */
export function sellerPayTo(): { ok: true; payTo: string } | { ok: false; error: string } {
  const p = (process.env.FIANGSHI_PAYTO ?? "").trim();
  if (!p) return { ok: false, error: "FIANGSHI_PAYTO not configured: paid endpoints are disabled (no address is invented)" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(p)) return { ok: false, error: "FIANGSHI_PAYTO is not a 0x address" };
  const g = v6({ payTo: p, asset: USDC_BASE });
  if (g.band) return { ok: false, error: `FIANGSHI_PAYTO fails V6 (${g.rule})` };
  return { ok: true, payTo: p };
}

export function paymentRequired(resourceUrl: string, usd: number, payTo: string, description: string) {
  const accepts: Requirement[] = [
    { scheme: "exact", network: BASE_CAIP2, amount: usdToAtomic(usd), asset: USDC_BASE, payTo, maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } },
  ];
  const body = { x402Version: 2, error: "X-PAYMENT header is required", resource: { url: resourceUrl, description, mimeType: "application/json" }, accepts };
  return { body, header: Buffer.from(JSON.stringify(body)).toString("base64") };
}

/**
 * The `X-PAYMENT-RESPONSE` header (base64 JSON) sent with a paid answer. Settlement is dry-run: nothing was submitted
 * on chain, so success is false and there is no transaction; the header says so instead of implying a settled payment.
 */
export function paymentResponse(network: string, payer: string | null): string {
  const body = { success: false, transaction: null, network, payer, settlement: currentSettlement(), errorReason: "dry-run: the payment was checked for structure only and was not settled" };
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

export interface PaymentCheck {
  ok: boolean;
  errors: string[];
  from: string | null;
  value: string | null;
  signature_verified: false; // structure only here; with FIANGSHI_SETTLE=live the facilitator verifies the signature
  /** the decoded payment, as the client sent it (handed to the facilitator unchanged in live mode) */
  payload: unknown;
}

const hex = (n: number) => new RegExp(`^0x[0-9a-fA-F]{${n}}$`);

/** Structural validation only. Never settles. */
export function verifyXPayment(header: string | undefined, req: Requirement, nowS = Math.floor(Date.now() / 1000)): PaymentCheck {
  const out: PaymentCheck = { ok: false, errors: [], from: null, value: null, signature_verified: false, payload: null };
  if (!header) return { ...out, errors: ["missing X-PAYMENT header"] };
  let p: any;
  try {
    p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return { ...out, errors: ["X-PAYMENT is not base64 JSON"] };
  }
  out.payload = p;
  const e = out.errors;
  // x402 v2 PaymentPayload carries the chosen terms in `accepted`; the older shape puts scheme and network at the top
  const acc = p?.accepted;
  const scheme = acc ? acc.scheme : p?.scheme;
  const network = acc ? acc.network : p?.network;
  if (typeof p?.x402Version !== "number") e.push("x402Version missing");
  if (scheme !== "exact") e.push(`scheme must be "exact"`);
  if (network !== req.network && !(network === "base" && req.network === BASE_CAIP2)) e.push(`network must be ${req.network}`);
  if (acc) {
    if (typeof acc.payTo !== "string" || acc.payTo.toLowerCase() !== req.payTo.toLowerCase()) e.push("accepted.payTo is not the payTo");
    if (typeof acc.asset !== "string" || acc.asset.toLowerCase() !== req.asset.toLowerCase()) e.push("accepted.asset is not the asset asked");
    if (typeof acc.amount !== "string" || !/^\d+$/.test(acc.amount) || BigInt(acc.amount) < BigInt(req.amount)) e.push(`accepted.amount is below the required ${req.amount}`);
  }
  const a = p?.payload?.authorization;
  const sig = p?.payload?.signature;
  if (!a) e.push("payload.authorization missing");
  else {
    if (typeof a.from !== "string" || !hex(40).test(a.from)) e.push("authorization.from is not an address");
    else if (checksumValid(a.from) === false) e.push("authorization.from fails EIP-55");
    if (typeof a.to !== "string" || a.to.toLowerCase() !== req.payTo.toLowerCase()) e.push("authorization.to is not the payTo");
    if (typeof a.value !== "string" || !/^\d+$/.test(a.value)) e.push("authorization.value is not an atomic integer string");
    else if (BigInt(a.value) < BigInt(req.amount)) e.push(`authorization.value ${a.value} < required ${req.amount}`);
    const va = Number(a.validAfter);
    const vb = Number(a.validBefore);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) e.push("validAfter/validBefore missing");
    else if (nowS < va || nowS > vb) e.push("authorization is outside its valid time window");
    if (typeof a.nonce !== "string" || !hex(64).test(a.nonce)) e.push("authorization.nonce is not 32 bytes hex");
  }
  if (typeof sig !== "string" || !hex(130).test(sig)) e.push("payload.signature is not 65 bytes hex");
  out.ok = e.length === 0;
  out.from = a?.from ?? null;
  out.value = a?.value ?? null;
  return out;
}

/** Build a well-formed (UNSIGNED-placeholder) X-PAYMENT for local testing only. The signature bytes are not a real signature. */
export function demoXPayment(req: Requirement, from: string, nowS = Math.floor(Date.now() / 1000)): string {
  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: req.network,
    payload: {
      signature: "0x" + "11".repeat(65),
      authorization: { from, to: req.payTo, value: req.amount, validAfter: String(nowS - 60), validBefore: String(nowS + 600), nonce: "0x" + "ab".repeat(32) },
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
