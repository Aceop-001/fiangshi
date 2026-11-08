/**
 * Probe: unpaid GET, parse the 402, terms_hash = sha256(canonical terms).
 * Parses x402 v1 PaymentRequirements in the JSON body (`accepts[]`).
 * TODO(api-wiring): confirm against real recorded 402s; if live responses carry requirements in headers,
 * record them into fixtures/402 first and extend the parser with a test — never special-case.
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

const Requirement = z
  .object({
    scheme: z.string(),
    network: z.string().min(1),
    maxAmountRequired: z.string().regex(/^\d+$/),
    payTo: z.string().min(1),
    asset: z.string().min(1),
    resource: z.string().optional(),
  })
  .passthrough();
const Body402 = z.object({ x402Version: z.number(), accepts: z.array(Requirement).min(1) }).passthrough();

export type ProbeResult = { ok: true; terms: Terms; raw: RawResponse } | { ok: false; error: string; raw: RawResponse | null };

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
      return { ok: false, error: "402 body is not JSON", raw };
    }
  }
  const parsed = Body402.safeParse(body);
  if (!parsed.success) return { ok: false, error: "402 body has no valid x402 accepts[]", raw };
  const req = parsed.data.accepts.find((a) => a.scheme === "exact") ?? parsed.data.accepts[0]!;
  const base = {
    url: raw.url,
    price: priceUsd(req.network, req.asset, req.maxAmountRequired),
    asset: req.asset.toLowerCase(),
    network: req.network,
    payee: req.payTo.toLowerCase(),
  };
  return { ok: true, terms: { ...base, terms_hash: termsHash(base) }, raw };
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
