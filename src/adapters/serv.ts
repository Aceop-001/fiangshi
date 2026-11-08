/**
 * SERV Reasoning adapter (advisory model). OpenAI-compatible chat/completions.
 * Validation lives in core/decide.ts; this file only transports text and caches it.
 * Mock modes (MOCK_MODELS) exist ONLY here, at the adapter boundary:
 *   good | allow | broken | hallucinated | badquote
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../../scripts/budget.js";
import { PROBE_TIMEOUT_MS, dataDir, env, isOffline, mockModels, num } from "../config.js";
import { hashOf } from "../core/canonical.js";
import { validateModelOutput, type ModelAdvice } from "../core/decide.js";
import { bandForScore, type Band, type PayeeSignals, type Terms } from "../core/types.js";

export interface AdjudicationInput {
  terms: Terms | null;
  signals: PayeeSignals;
  score: number;
  silence: boolean;
}

const CITE_PREFERENCE = ["wallet_age_hours", "distinct_payers", "first_funder", "total_received_usd", "tx_count"];

function mockText(mode: string, i: AdjudicationInput): string {
  const ev = i.signals.evidence;
  const keys = CITE_PREFERENCE.filter((k) => (ev[k] ?? "").length > 0).slice(0, 2);
  const cites = keys.map((k) => ({ signal: k, quote: ev[k]! }));
  const band: Band = i.silence ? "REVIEW" : bandForScore(i.score);
  switch (mode) {
    case "good":
      return JSON.stringify({ band, citations: cites, rationale: "mock: mirrors deterministic score" });
    case "allow":
      return JSON.stringify({ band: "ALLOW", citations: cites, rationale: "mock: always ALLOW (vow precedence test)" });
    case "hallucinated":
      return JSON.stringify({ band: "ALLOW", citations: [{ signal: "wallet_reputation", quote: "trusted by many agents" }] });
    case "badquote":
      return JSON.stringify({ band: "ALLOW", citations: cites.map((c) => ({ ...c, quote: c.quote + " (verified by auditor)" })) });
    case "broken":
    default:
      return "Sure! Here is my verdict: ALLOW";
  }
}

function prompt(i: AdjudicationInput, strict: boolean): { system: string; user: string } {
  const system =
    "You adjudicate whether an AI agent should pay an x402 endpoint. Reply with JSON only: " +
    '{"band":"ALLOW"|"REVIEW"|"BLOCK","citations":[{"signal":<evidence key>,"quote":<exact substring of that evidence>}],"rationale":<short>}. ' +
    "Cite only keys present in `evidence`. Quotes must be copied verbatim." +
    (strict ? " STRICT: your previous reply was rejected. Output a single JSON object, no prose, no markdown, quotes copied character-for-character." : "");
  const user = JSON.stringify({ terms: i.terms, signals: i.signals, deterministic_score: i.score });
  return { system, user };
}

/**
 * Strict JSON schema forwarded via `response_format` (docs.openserv.ai/serv-reasoning/tutorials/structured-outputs).
 * `rationale` is the model's reasoning field in OUR contract; it is required and must be a string.
 * (SERV's own reasoning trace exists only on POST /v1/responses for OpenAI models; chat completions has no reasoning field.)
 */
export const VERDICT_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "fiangshi_verdict",
    strict: true,
    schema: {
      type: "object",
      properties: {
        band: { type: "string", enum: ["ALLOW", "REVIEW", "BLOCK"] },
        citations: {
          type: "array",
          items: { type: "object", properties: { signal: { type: "string" }, quote: { type: "string" } }, required: ["signal", "quote"], additionalProperties: false },
        },
        rationale: { type: "string" },
      },
      required: ["band", "citations", "rationale"],
      additionalProperties: false,
    },
  },
} as const;

/** Per-call metadata for smoke reports. Never contains the key. */
export interface ModelCallMeta {
  provider: "serv" | "dolphin";
  model: string;
  ms: number;
  status: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  finish_reason: string | null;
  error: string | null;
  raw: unknown;
}
export const modelCalls: ModelCallMeta[] = [];
export const modelTimeoutMs = () => num("FIANGSHI_MODEL_TIMEOUT_MS", PROBE_TIMEOUT_MS);

interface ChatJson {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * One OpenAI-compatible chat completion. Fails closed by THROWING on: HTTP error, timeout, empty body,
 * non-JSON body, missing content, truncation (finish_reason=length). Callers turn throws into degraded verdicts.
 */
export async function chatCompletion(
  provider: "serv" | "dolphin",
  base: string,
  key: string,
  body: Record<string, unknown>,
): Promise<{ text: string; meta: ModelCallMeta }> {
  const t0 = Date.now();
  const meta: ModelCallMeta = { provider, model: String(body.model), ms: 0, status: null, prompt_tokens: null, completion_tokens: null, total_tokens: null, finish_reason: null, error: null, raw: null };
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(modelTimeoutMs()),
    });
    meta.status = res.status;
    if (!res.ok) throw new Error(`${provider}: HTTP ${res.status}`); // never echo the body: it may reflect the key
    const text = await res.text();
    if (!text.trim()) throw new Error(`${provider}: empty response body`);
    let j: ChatJson;
    try {
      j = JSON.parse(text) as ChatJson;
    } catch {
      throw new Error(`${provider}: response body is not JSON`);
    }
    meta.raw = j;
    meta.prompt_tokens = j.usage?.prompt_tokens ?? null;
    meta.completion_tokens = j.usage?.completion_tokens ?? null;
    meta.total_tokens = j.usage?.total_tokens ?? null;
    meta.finish_reason = j.choices?.[0]?.finish_reason ?? null;
    if (meta.finish_reason === "length") throw new Error(`${provider}: output truncated (finish_reason=length)`);
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error(`${provider}: empty message content`);
    return { text: content, meta };
  } catch (e) {
    const err = e as Error;
    meta.error = err.name === "TimeoutError" || err.name === "AbortError" ? `${provider}: timeout after ${modelTimeoutMs()}ms` : err.message;
    throw new Error(meta.error);
  } finally {
    meta.ms = Date.now() - t0;
    modelCalls.push(meta);
  }
}

async function liveText(i: AdjudicationInput, strict: boolean): Promise<string> {
  const key = env("SERV_REASONING_API_KEY");
  const model = env("SERV_MODEL");
  const base = env("SERV_BASE_URL", "https://inference-api.openserv.ai/v1");
  if (!key || !model) throw new Error("serv: SERV_REASONING_API_KEY / SERV_MODEL not set");
  const { system, user } = prompt(i, strict);
  return guarded("serv", `adjudicate ${i.signals.payee.slice(0, 10)}`, async () => {
    const { text, meta } = await chatCompletion("serv", base, key, {
      model,
      temperature: 0,
      max_completion_tokens: 600,
      response_format: VERDICT_SCHEMA,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return { value: text, units: meta.total_tokens };
  });
}

export async function adjudicate(i: AdjudicationInput): Promise<ModelAdvice> {
  const mode = mockModels();
  const useMock = mode !== "" || isOffline();
  const model = useMock ? `mock:${mode || "broken"}` : env("SERV_MODEL", "unset");
  const cacheKey = hashOf({ payee: i.signals.payee, terms_hash: i.terms?.terms_hash ?? null, model });
  const cachePath = join(dataDir(), "cache", "serv", `${cacheKey}.json`);
  if (!useMock && existsSync(cachePath)) {
    const text = (JSON.parse(readFileSync(cachePath, "utf8")) as { text: string }).text;
    return { model, validation: validateModelOutput(text, i.signals), attempts: 0 };
  }
  let attempts = 0;
  let last: ModelAdvice = { model, validation: null, attempts };
  for (const strict of [false, true]) {
    attempts++;
    let text: string;
    try {
      text = useMock ? mockText(mode || "broken", i) : await liveText(i, strict);
    } catch (e) {
      process.stderr.write(`WARN serv unavailable (${(e as Error).message}); degraded verdict\n`);
      return { model, validation: null, attempts };
    }
    const v = validateModelOutput(text, i.signals);
    last = { model, validation: v, attempts };
    if (v.ok) {
      if (!useMock) {
        mkdirSync(join(dataDir(), "cache", "serv"), { recursive: true });
        writeFileSync(cachePath, JSON.stringify({ text }));
      }
      return last;
    }
  }
  if (!useMock) process.stderr.write(`WARN serv output rejected twice; degraded verdict\n`);
  return last;
}
