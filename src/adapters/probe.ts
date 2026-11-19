/**
 * Probe: unpaid GET, parse the 402, terms_hash = sha256(canonical terms).
 * Parses x402 PaymentRequirements: v1 (`maxAmountRequired`, short network) and v2 (`amount`, CAIP-2 network),
 * from the JSON body `accepts[]`, the `payment-required` or `x-payment-required` header (base64 or raw JSON),
 * `www-authenticate`, or JSON embedded in a 402 HTML page (post-deadline, 2026-11-19). A 402 that yields no terms is
 * a structured PAYMENT_TERMS_UNPARSEABLE failure with the reason and the redacted headers, never a bare error.
 * Verified against 12 real responses recorded in fixtures/402/real (2026-11-08).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PROBE_TIMEOUT_MS, fixturesDir, isOffline, snapshotSource } from "../config.js";
import { hashOf } from "../core/canonical.js";
import { RawResponse, type Terms } from "../core/types.js";

/** Known assets (network:address lowercase) -> decimals. Unknown asset => price null => silence => REVIEW. */
export const ASSETS: Record<string, { symbol: string; decimals: number }> = {
  "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  "base-sepolia:0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6 },
};

/** CAIP-2 (x402 v2) -> short network names used as ASSETS keys. */
export const CAIP2: Record<string, string> = { "eip155:8453": "base", "eip155:84532": "base-sepolia" };
export const normalizeNetwork = (n: string) => CAIP2[n] ?? n;

// v1 uses maxAmountRequired; v2 uses amount. Accept either, both must be atomic-unit integer strings.
const Requirement = z
  .object({
    scheme: z.string(),
    network: z.string().min(1),
    maxAmountRequired: z.string().regex(/^\d+$/).optional(),
    amount: z.string().regex(/^\d+$/).optional(),
    payTo: z.string().min(1),
    asset: z.string().min(1),
  })
  .passthrough()
  .refine((r) => r.amount !== undefined || r.maxAmountRequired !== undefined, "amount or maxAmountRequired required");
type Req = z.infer<typeof Requirement>;
// Entries are validated one by one: multi-chain servers list options (Hyperliquid, XRPL) whose amounts are decimals.
// One non-conforming alternative must not hide a valid Base option (bug found in the 200-payee probe, 2026-11-08).
export const Body402 = z.object({ x402Version: z.number(), accepts: z.array(z.unknown()).min(1) }).passthrough();

/** Pick the requirement to price: exact + known network, then exact, then first valid. */
export function pickRequirement(accepts: unknown[]): Req | null {
  const valid = accepts.flatMap((a) => {
    const r = Requirement.safeParse(a);
    return r.success ? [r.data] : [];
  });
  const known = (r: Req) => normalizeNetwork(r.network) !== r.network || Object.keys(ASSETS).some((k) => k.startsWith(`${r.network}:`));
  return valid.find((r) => r.scheme === "exact" && known(r)) ?? valid.find((r) => r.scheme === "exact") ?? valid[0] ?? null;
}

const header = (headers: Record<string, string>, name: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];

/** A header value that is JSON, either raw or base64-encoded (servers do both). */
function jsonValue(v: string | undefined): unknown {
  if (!v) return undefined;
  const t = v.trim();
  for (const s of [t, (() => { try { return Buffer.from(t, "base64").toString("utf8"); } catch { return ""; } })()]) {
    if (!s || !/^[[{]/.test(s.trim())) continue;
    try {
      return JSON.parse(s);
    } catch {
      /* next form */
    }
  }
  return undefined;
}

/**
 * `WWW-Authenticate` carrying terms. Two forms are read: a token68 that is (base64) JSON with `accepts[]`, and
 * auth-params naming the requirement fields themselves (payTo, amount or maxAmountRequired, network, asset). Field
 * names are the x402 PaymentRequirements names; nothing else is guessed.
 */
function fromWwwAuthenticate(v: string | undefined): unknown {
  if (!v) return undefined;
  const m = /^\s*[A-Za-z0-9_-]+\s+(.*)$/s.exec(v);
  const rest = (m?.[1] ?? v).trim();
  const token = jsonValue(rest);
  if (token) return token;
  const params: Record<string, string> = {};
  for (const p of rest.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g)) params[p[1]!] = p[2] ?? p[3] ?? "";
  for (const k of ["accepts", "payment_required", "paymentRequired"]) if (params[k]) return jsonValue(params[k]);
  if (params.payTo && (params.amount || params.maxAmountRequired) && params.network && params.asset)
    return { x402Version: Number(params.x402Version) || 0, accepts: [{ scheme: params.scheme || "exact", network: params.network, amount: params.amount, maxAmountRequired: params.maxAmountRequired, payTo: params.payTo, asset: params.asset }] };
  return undefined;
}

/** A 402 HTML page that embeds its terms in `<script type="application/json">` blocks. */
function fromHtml(text: unknown): unknown[] {
  if (typeof text !== "string" || !/<script/i.test(text)) return [];
  const out: unknown[] = [];
  for (const m of text.matchAll(/<script[^>]*type\s*=\s*["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1]!));
    } catch {
      /* not JSON */
    }
  }
  return out;
}

/** Shapes seen in the wild, normalised to { x402Version, accepts[] }: accepts as one object, or a bare requirement list. */
function normalise(c: unknown): unknown {
  if (Array.isArray(c)) return { x402Version: 0, accepts: c };
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    if (o.accepts && !Array.isArray(o.accepts) && typeof o.accepts === "object") return { ...o, x402Version: typeof o.x402Version === "number" ? o.x402Version : 0, accepts: [o.accepts] };
    if (Array.isArray(o.accepts) && typeof o.x402Version !== "number") return { ...o, x402Version: 0 };
  }
  return c;
}

/** Headers kept on an unparseable record: everything that could say who is behind it, never cookies or credentials. */
export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    const key = k.toLowerCase();
    if (/^(set-cookie|cookie|authorization|proxy-authorization)$/.test(key) || /token|secret|session/.test(key)) out[key] = "[redacted]";
    else out[key] = v.length > 300 ? `${v.slice(0, 300)}…` : v;
  }
  return out;
}

/** Why a 402 had no usable terms, said plainly. A hosting platform's own 402 is not a payment offer. */
function unparseableReason(raw: RawResponse): string {
  const vercel = header(raw.headers, "x-vercel-error");
  if (vercel) return `host-level 402 from Vercel (${vercel}): the hosting platform is refusing the deployment; this is not an x402 offer`;
  const ct = header(raw.headers, "content-type") ?? "no content-type";
  return `402 has no valid x402 accepts[] in body or payment-required header (body ${ct}; also looked in x-payment-required, www-authenticate and embedded JSON)`;
}

/** payTo_raw keeps the case exactly as the 402 sent it (Terms.payee is lowercased); V6 needs it for EIP-55. */
export type ProbeFailureClass = "PAYMENT_TERMS_UNPARSEABLE" | "NOT_402" | "UNREACHABLE";
export type ProbeResult =
  | { ok: true; terms: Terms; raw: RawResponse; payTo_raw: string }
  | { ok: false; error: string; raw: RawResponse | null; class?: ProbeFailureClass; headers?: Record<string, string> };

export function priceUsd(network: string, asset: string, atomic: string): number | null {
  const a = ASSETS[`${network}:${asset.toLowerCase()}`];
  if (!a) return null;
  return Number(BigInt(atomic)) / 10 ** a.decimals;
}

export function termsHash(t: Omit<Terms, "terms_hash">): string {
  return hashOf({ url: t.url, price: t.price, asset: t.asset, network: t.network, payee: t.payee });
}

export function parse402(raw: RawResponse): ProbeResult {
  if (raw.status !== 402) return { ok: false, error: `status ${raw.status}, expected 402`, raw, class: "NOT_402" };
  let body = raw.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = undefined;
    }
  }
  // Body first (v1 and many v2 servers), then the v2 `payment-required` header (base64 or raw JSON), then the forms
  // other servers use: `x-payment-required`, `www-authenticate`, and JSON embedded in a 402 HTML page.
  let req: Req | null = null;
  const candidates = [
    body,
    jsonValue(header(raw.headers, "payment-required")),
    jsonValue(header(raw.headers, "x-payment-required")),
    fromWwwAuthenticate(header(raw.headers, "www-authenticate")),
    ...fromHtml(raw.body),
  ];
  for (const candidate of candidates) {
    const parsed = Body402.safeParse(normalise(candidate));
    if (parsed.success) req = pickRequirement(parsed.data.accepts);
    if (req) break;
  }
  if (!req) return { ok: false, error: unparseableReason(raw), raw, class: "PAYMENT_TERMS_UNPARSEABLE", headers: redactHeaders(raw.headers) };
  const network = normalizeNetwork(req.network);
  const base = {
    url: raw.url,
    price: priceUsd(network, req.asset, (req.amount ?? req.maxAmountRequired)!),
    asset: req.asset.toLowerCase(),
    network,
    payee: req.payTo.toLowerCase(),
  };
  return { ok: true, terms: { ...base, terms_hash: termsHash(base) }, raw, payTo_raw: req.payTo.trim() };
}

export function loadFixtures402(dir = join(fixturesDir(), "402")): RawResponse[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => RawResponse.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

async function fetchUnpaid(url: string): Promise<RawResponse> {
  if (isOffline() || snapshotSource() === "fixture") {
    const real = join(fixturesDir(), "402", "real");
    const hit = loadFixtures402().find((r) => r.url === url) ?? (existsSync(real) ? loadFixtures402(real).find((r) => r.url === url) : undefined);
    if (!hit) throw new Error(`offline: no 402 fixture recorded for ${url}`);
    return hit;
  }
  const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { url, status: res.status, headers, body };
}

export async function probe(url: string): Promise<ProbeResult> {
  try {
    return parse402(await fetchUnpaid(url));
  } catch (e) {
    return { ok: false, error: (e as Error).message, raw: null, class: "UNREACHABLE" };
  }
}
