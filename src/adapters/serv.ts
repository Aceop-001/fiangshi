/**
 * SERV Reasoning adapter (advisory model). OpenAI-compatible chat/completions.
 * Validation lives in core/decide.ts; this file only transports text and caches it.
 * Mock modes (MOCK_MODELS) exist ONLY here, at the adapter boundary:
 *   good | allow | broken | hallucinated | badquote
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../../scripts/budget.js";
import { PROBE_TIMEOUT_MS, dataDir, env, isOffline, mockModels } from "../config.js";
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

async function liveText(i: AdjudicationInput, strict: boolean): Promise<string> {
  const key = env("SERV_REASONING_API_KEY");
  const model = env("SERV_MODEL");
  const base = env("SERV_BASE_URL", "https://inference-api.openserv.ai/v1");
  if (!key || !model) throw new Error("serv: SERV_REASONING_API_KEY / SERV_MODEL not set");
  const { system, user } = prompt(i, strict);
  return guarded("serv", `adjudicate ${i.signals.payee.slice(0, 10)}`, async () => {
    const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`serv: HTTP ${res.status}`); // never echo body (may reflect key)
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
    return { value: j.choices?.[0]?.message?.content ?? "", units: j.usage?.total_tokens ?? null };
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
