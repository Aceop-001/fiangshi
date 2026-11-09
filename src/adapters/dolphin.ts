/**
 * Dolphin adapter: seller prose -> typed identity claims. Extraction only: no verdict, no scoring.
 * Every input string is hashed and cached forever (data/cache/dolphin/<sha256>.json).
 *
 * Live transport, confirmed from https://dphn.ai/docs/dphn-api (retrieved 2026-11-08):
 *   base URL  https://lighthouse.dphn.ai/run/text-v/v1   (OpenAI-compatible; POST /chat/completions, GET /models)
 *   model     deepseek-ai/DeepSeek-V4.1-Flash            ($0.01 in / $0.07 out per 1M tokens)
 *   auth      Authorization: Bearer $DOLPHIN_API_KEY      errors: 401 key, 402 credits, 404 model, 429 rate
 * The docs list no structured-output parameter, so none is sent; the reply is validated with zod and fails closed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { guarded } from "../../scripts/budget.js";
import { dataDir, env, isOffline } from "../config.js";
import { sha256 } from "../core/canonical.js";
import { chatCompletion } from "./serv.js";

export const DOLPHIN_DEFAULT_BASE = "https://lighthouse.dphn.ai/run/text-v/v1";
export const DOLPHIN_DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

export const IdentityClaims = z
  .object({
    claims_org: z.string().nullable(),
    claims_product: z.string().nullable(),
    claims_age_claim: z.string().nullable(),
  })
  .strict();
export type IdentityClaims = z.infer<typeof IdentityClaims>;

export type Transport = (text: string) => Promise<unknown>;

const SYSTEM =
  "Extract identity claims from a seller's self-description. Reply with ONE JSON object and nothing else: " +
  '{"claims_org": string|null, "claims_product": string|null, "claims_age_claim": string|null}. ' +
  "Copy names verbatim from the text; use null when the text does not state it. Do not judge trustworthiness.";

/** Parse model text as JSON; tolerate exactly one ```json fenced block, nothing else. */
export function parseClaimsText(text: string): unknown {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return JSON.parse(fenced ? fenced[1]! : t);
}

export const liveTransport: Transport = async (text) => {
  if (isOffline()) throw new Error("offline: dolphin live call refused");
  const key = env("DOLPHIN_API_KEY");
  if (!key) throw new Error("dolphin: DOLPHIN_API_KEY not set");
  const base = env("DOLPHIN_BASE_URL", DOLPHIN_DEFAULT_BASE) || DOLPHIN_DEFAULT_BASE;
  const model = env("DOLPHIN_MODEL", DOLPHIN_DEFAULT_MODEL) || DOLPHIN_DEFAULT_MODEL;
  return guarded("dolphin", `extract ${sha256(text).slice(0, 8)}`, async () => {
    const { text: out, meta } = await chatCompletion("dolphin", base, key, {
      model,
      temperature: 0,
      max_tokens: 1024, // DeepSeek V4.1 Flash emits a `reasoning` field first; 200 truncated the answer (2026-11-09 smoke)
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    });
    return { value: parseClaimsText(out), units: meta.total_tokens };
  });
};

export interface ExtractResult {
  claims: IdentityClaims | null;
  cached: boolean;
  calls: number;
  error?: string;
}

/** Never throws. Malformed output, timeout, empty body, HTTP error -> claims null (identity stays unclaimed). */
export async function extractIdentity(text: string, transport: Transport = liveTransport, dir = join(dataDir(), "cache", "dolphin")): Promise<ExtractResult> {
  const path = join(dir, `${sha256(text)}.json`);
  if (existsSync(path)) return { claims: IdentityClaims.parse(JSON.parse(readFileSync(path, "utf8"))), cached: true, calls: 0 };
  let raw: unknown;
  try {
    try {
      raw = await transport(text);
    } catch (e) {
      // exactly one retry, and only for a timeout (a malformed or refused reply is not retried)
      if (!/timeout/i.test((e as Error).message)) throw e;
      raw = await transport(text);
    }
  } catch (e) {
    return { claims: null, cached: false, calls: 0, error: (e as Error).message };
  }
  const parsed = IdentityClaims.safeParse(raw);
  if (!parsed.success) return { claims: null, cached: false, calls: 1, error: "schema: dolphin output does not match IdentityClaims" };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(parsed.data));
  return { claims: parsed.data, cached: false, calls: 1 };
}
