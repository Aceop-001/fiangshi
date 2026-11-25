/**
 * Live settlement through the Coinbase CDP x402 facilitator (2026-11-24). Fiangshi never signs or sends a transaction
 * and never holds funds: the payer signs an EIP-3009 authorization, the facilitator verifies it and submits it, and USDC
 * moves from the payer straight to the seller's payTo. Off by default: FIANGSHI_SETTLE=live turns it on.
 *
 * API (read 2026-11-24, docs.cdp.coinbase.com): POST https://api.cdp.coinbase.com/platform/v2/x402/verify and /settle,
 * body { x402Version, paymentPayload, paymentRequirements }; verify answers { isValid, invalidReason?, payer },
 * settle answers { success, errorReason?, transaction, network, payer }. Auth: "Authorization: Bearer <JWT>", the JWT
 * signed with the CDP Secret API Key (Ed25519, alg EdDSA; header kid + nonce; claims sub = key id, iss "cdp",
 * aud ["cdp_service"], nbf, exp = nbf + 120, uri "<METHOD> <host><path>"). The secret is base64 of 64 bytes: a 32-byte
 * seed then the 32-byte public key.
 */
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { env } from "../config.js";

export const CDP_HOST = "api.cdp.coinbase.com";
const BASE_PATH = "/platform/v2/x402";

export type SettleMode = "dry-run" | "live";
// values pasted into a dashboard often carry a stray space or capital: "Live " still means live
export const settleMode = (): SettleMode => (env("FIANGSHI_SETTLE").trim().toLowerCase() === "live" ? "live" : "dry-run");
const keyId = () => env("CDP_API_KEY_ID").trim() || null;
const keySecret = () => env("CDP_API_KEY_SECRET").trim() || null;

/** The secret's shape, never its value: an Ed25519 CDP secret is base64 of 64 bytes. */
export function secretShape(secret: string | null): "missing" | "ok" | "pem" | "wrong length" {
  if (!secret) return "missing";
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(secret)) return "pem";
  return Buffer.from(secret, "base64").length === 64 ? "ok" : "wrong length";
}

/** What /health reports about settlement: each piece present or not, never a value. */
export function settleCheck() {
  const raw = env("FIANGSHI_SETTLE").trim().toLowerCase();
  const shape = secretShape(keySecret());
  const ready = settleReady();
  return {
    requested: raw === "live" ? "live" : raw === "" || raw === "dry-run" ? "dry-run" : `unrecognised value (${raw.length} chars; use "live")`,
    cdp_api_key_id: keyId() ? "set" : "missing",
    cdp_api_key_secret: shape === "ok" ? "set (Ed25519, 64 bytes)" : shape === "missing" ? "missing" : shape === "pem" ? "wrong kind: a PEM key (legacy ECDSA); create a Secret API Key with the Ed25519 algorithm" : "wrong format: not base64 of 64 bytes (the Ed25519 secret as shown once in the CDP portal)",
    ready: ready.ok,
    ...(ready.ok ? {} : { why: ready.why }),
  };
}

/** live settlement needs the flag and both key parts, the secret in Ed25519 form; anything less stays dry-run and says why */
export function settleReady(): { ok: true } | { ok: false; why: string } {
  if (settleMode() !== "live") return { ok: false, why: "FIANGSHI_SETTLE is not live" };
  if (!keyId() || !keySecret()) return { ok: false, why: "FIANGSHI_SETTLE=live but CDP_API_KEY_ID / CDP_API_KEY_SECRET are not set" };
  if (secretShape(keySecret()) !== "ok") return { ok: false, why: "CDP_API_KEY_SECRET is not an Ed25519 secret (base64 of 64 bytes)" };
  return { ok: true };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
/** PKCS#8 DER prefix for an Ed25519 private key; the 32-byte seed follows it. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function cdpJwt(method: "GET" | "POST", path: string, nowS = Math.floor(Date.now() / 1000), id = keyId(), secret = keySecret()): string {
  if (!id || !secret) throw new Error("CDP API key not configured");
  const raw = Buffer.from(secret, "base64");
  if (raw.length !== 64) throw new Error("CDP_API_KEY_SECRET must be base64 of 64 bytes (Ed25519 seed + public key)");
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, raw.subarray(0, 32)]), format: "der", type: "pkcs8" });
  const header = { alg: "EdDSA", typ: "JWT", kid: id, nonce: randomBytes(16).toString("hex") };
  const claims = { sub: id, iss: "cdp", aud: ["cdp_service"], nbf: nowS, exp: nowS + 120, uri: `${method} ${CDP_HOST}${path}` };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${input}.${b64url(sign(null, Buffer.from(input), key))}`;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** tests only: observe the HTTP boundary */
export const setFacilitatorFetch = (f: Fetch) => (fetchImpl = f);

async function call<T>(op: "verify" | "settle", paymentPayload: unknown, paymentRequirements: unknown): Promise<T> {
  const path = `${BASE_PATH}/${op}`;
  const r = await fetchImpl(`https://${CDP_HOST}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cdpJwt("POST", path)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
    signal: AbortSignal.timeout(op === "settle" ? 30_000 : 10_000),
  });
  const text = await r.text();
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`facilitator ${op}: HTTP ${r.status}, not JSON`);
  }
  // 400 carries a structured rejection (isValid false / success false); other errors are { errorType, errorMessage }
  if (!r.ok && r.status !== 400) throw new Error(`facilitator ${op}: HTTP ${r.status} ${(j as { errorMessage?: string }).errorMessage ?? ""}`.trim());
  return j as T;
}

export interface VerifyResult { isValid: boolean; invalidReason?: string; invalidMessage?: string; payer?: string }
export interface SettleResult { success: boolean; errorReason?: string; errorMessage?: string; transaction: string; network: string; payer?: string }

export const facilitatorVerify = (payload: unknown, req: unknown) => call<VerifyResult>("verify", payload, req);
export const facilitatorSettle = (payload: unknown, req: unknown) => call<SettleResult>("settle", payload, req);

/** A settled transaction hash as the receipt stores it (a 32-byte hex tx hash on Base). */
export const isTxHash = (t: unknown): t is string => typeof t === "string" && /^0x[0-9a-fA-F]{64}$/.test(t);
