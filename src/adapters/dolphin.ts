/**
 * Dolphin adapter: seller prose -> typed identity claims. Extraction only: no verdict, no scoring.
 * Every input string is hashed and cached forever (data/cache/dolphin/<sha256>.json).
 *
 * TODO(api-wiring §C): live transport. DOLPHIN_BASE_URL / DOLPHIN_MODEL must be confirmed from dphn.ai
 * docs first; until then live extraction is refused and identity stays as recorded in the snapshot.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataDir, env, isOffline } from "../config.js";
import { sha256 } from "../core/canonical.js";

export const IdentityClaims = z.object({
  claims_org: z.string().nullable(),
  claims_product: z.string().nullable(),
  claims_age_claim: z.string().nullable(),
});
export type IdentityClaims = z.infer<typeof IdentityClaims>;

export type Transport = (text: string) => Promise<unknown>;

const refuseLive: Transport = async () => {
  if (isOffline()) throw new Error("offline: dolphin live call refused");
  if (!env("DOLPHIN_BASE_URL") || !env("DOLPHIN_MODEL")) throw new Error("dolphin: base URL / model not confirmed (docs/API_WIRING.md §C)");
  throw new Error("dolphin: live transport not wired yet");
};

export interface ExtractResult {
  claims: IdentityClaims | null;
  cached: boolean;
  calls: number;
}

export async function extractIdentity(text: string, transport: Transport = refuseLive, dir = join(dataDir(), "cache", "dolphin")): Promise<ExtractResult> {
  const path = join(dir, `${sha256(text)}.json`);
  if (existsSync(path)) return { claims: IdentityClaims.parse(JSON.parse(readFileSync(path, "utf8"))), cached: true, calls: 0 };
  let raw: unknown;
  try {
    raw = await transport(text);
  } catch {
    return { claims: null, cached: false, calls: 0 };
  }
  const parsed = IdentityClaims.safeParse(raw);
  if (!parsed.success) return { claims: null, cached: false, calls: 1 };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(parsed.data));
  return { claims: parsed.data, cached: false, calls: 1 };
}
