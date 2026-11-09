/**
 * Probe: unpaid GET, parse the 402, terms_hash = sha256(canonical terms).
 * Parses x402 PaymentRequirements: v1 (`maxAmountRequired`, short network) and v2 (`amount`, CAIP-2 network),
 * from the JSON body `accepts[]` or, for v2, the base64 `payment-required` header.
 * Verified against 12 real responses recorded in fixtures/402/real (2026-11-08).
 */
import { readdirSync, readFileSync } from "node:fs";
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

/** v2 servers send requirements base64-encoded in the `payment-required` header (body may be empty). */
function fromHeader(headers: Record<string, string>): unknown {
  const h = Object.entries(headers).find(([k]) => k.toLowerCase() === "payment-required")?.[1];
  if (!h) return undefined;
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** payTo_raw keeps the case exactly as the 402 sent it (Terms.payee is lowercased); V6 needs it for EIP-55. */
export type ProbeResult = { ok: true; terms: Terms; raw: RawResponse; payTo_raw: string } | { ok: false; error: string; raw: RawResponse | null };

export function priceUsd(network: string, asset: string, atomic: string): number | null {
  const a = ASSETS[`${network}:${asset.toLowerCase()}`];
  if (!a) return null;
  return Number(BigInt(atomic)) / 10 ** a.decimals;
}

export function termsHash(t: Omit<Terms, "terms_hash">): string {
  return hashOf({ url: t.url, price: t.price, asset: t.asset, network: t.network, payee: t.payee });
}

export function parse402(raw: RawResponse): ProbeResult {
  if (raw.status !== 402) return { ok: false, error: `status ${raw.status}, expected 402`, raw };
  let body = raw.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = undefined;
    }
  }
  // Body first (v1 and many v2 servers), then the v2 `payment-required` header.
  let req: Req | null = null;
  for (const candidate of [body, fromHeader(raw.headers)]) {
    const parsed = Body402.safeParse(candidate);
    if (parsed.success) req = pickRequirement(parsed.data.accepts);
    if (req) break;
  }
  if (!req) return { ok: false, error: "402 has no valid x402 accepts[] in body or payment-required header", raw };
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
    const hit = loadFixtures402().find((r) => r.url === url);
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
    return { ok: false, error: (e as Error).message, raw: null };
  }
}
