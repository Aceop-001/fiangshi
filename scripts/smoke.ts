/**
 * Real-model smoke: ONE call per payee, two live payees from fixtures/402/real, budget-guarded.
 *   npx tsx scripts/smoke.ts serv      needs SERV_REASONING_API_KEY + SERV_MODEL (+ FIANGSHI_SERV_PRICE_IN_PER_M / _OUT_PER_M for cost)
 *   npx tsx scripts/smoke.ts dolphin   needs DOLPHIN_API_KEY (base URL + model default to the documented values)
 * Signals come from cached Surf rows (fixtures/surf/smoke-12payees.json), so this spends 0 Surf credits.
 * Raw responses -> fixtures/models/<provider>-<payee>.json (keys never written). Prints: latency, tokens, cost, schema check,
 * and for SERV whether the model's band survived the vows unchanged.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFixtures402, parse402 } from "../src/adapters/probe.js";
import { modelCalls } from "../src/adapters/serv.js";
import { extractIdentity, liveTransport, DOLPHIN_DEFAULT_MODEL } from "../src/adapters/dolphin.js";
import { signalsFromSurf, type SurfPayeeRow } from "../src/adapters/surf.js";
import { evaluate } from "../src/check.js";
import { env, loadDotEnv, num } from "../src/config.js";

loadDotEnv();
const ROOT = join(import.meta.dirname, "..");
const provider = process.argv[2];
if (provider !== "serv" && provider !== "dolphin") {
  console.error("usage: smoke.ts serv|dolphin");
  process.exit(2);
}
const need = provider === "serv" ? ["SERV_REASONING_API_KEY", "SERV_MODEL"] : ["DOLPHIN_API_KEY"];
const missing = need.filter((k) => !env(k));
if (missing.length) {
  console.error(`smoke ${provider}: BLOCKED, missing ${missing.join(", ")} (set in .env; never committed). 0 calls made.`);
  process.exit(3);
}
process.env.MOCK_MODELS = "";

const live = loadFixtures402(join(ROOT, "fixtures", "402", "real")).map(parse402).filter((r) => r.ok).slice(0, 2);
const rows = (JSON.parse(readFileSync(join(ROOT, "fixtures/surf/smoke-12payees.json"), "utf8")) as { rows: SurfPayeeRow[] }).rows;
const now = Math.floor(Date.parse("2026-11-08T16:24:30Z") / 1000);
const out = join(ROOT, "fixtures", "models");
mkdirSync(out, { recursive: true });

const price = provider === "serv"
  ? { in: num("FIANGSHI_SERV_PRICE_IN_PER_M", NaN), out: num("FIANGSHI_SERV_PRICE_OUT_PER_M", NaN) }
  : { in: 0.01, out: 0.07 }; // dphn.ai/docs/dphn-api, DeepSeek V4.1 Flash, per 1M tokens
const cost = (pin: number | null, pout: number | null) =>
  Number.isFinite(price.in) && Number.isFinite(price.out) && pin !== null && pout !== null ? ((pin * price.in + pout * price.out) / 1e6).toFixed(8) : "n/a (set price env)";

for (const p of live) {
  if (!p.ok) continue;
  const t = p.terms;
  const before = modelCalls.length;
  let summary: Record<string, unknown>;
  if (provider === "serv") {
    const row = rows.find((r) => r.payee === t.payee) ?? { payee: t.payee };
    const s = signalsFromSurf(row, { now, windowStart: now - 365 * 86400, tokenContracts: [] });
    const d = await evaluate(t, s, {});
    const call = modelCalls[before];
    let rationaleOk = false;
    try {
      const content = (call?.raw as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
      rationaleOk = typeof (JSON.parse(content) as { rationale?: unknown }).rationale === "string";
    } catch {
      /* not JSON */
    }
    summary = {
      model: env("SERV_MODEL"),
      model_band: d.modelRawBand,
      final_band: d.verdict.band,
      survived_vows_unchanged: d.modelRawBand === d.verdict.band,
      vow_fired: d.verdict.vow_fired ?? null,
      degraded: d.verdict.degraded,
      schema_valid: d.validation?.ok ?? false,
      rationale_field_present: rationaleOk,
    };
  } else {
    const bio = `${t.url} — x402 endpoint, price $${t.price} USDC on Base`;
    const r = await extractIdentity(bio, liveTransport, join(ROOT, "data", "cache", "dolphin"));
    summary = { model: env("DOLPHIN_MODEL", DOLPHIN_DEFAULT_MODEL) || DOLPHIN_DEFAULT_MODEL, claims: r.claims, cached: r.cached, error: r.error ?? null, schema_valid: r.claims !== null };
  }
  const calls = modelCalls.slice(before);
  const m = calls[calls.length - 1];
  const record = { provider, payee: t.payee, url: t.url, summary, calls: calls.map((c) => ({ ...c })) };
  writeFileSync(join(out, `${provider}-${t.payee.slice(0, 10)}.json`), JSON.stringify(record, null, 2) + "\n");
  console.log(
    `${provider} ${t.payee.slice(0, 10)} | latency ${m?.ms ?? "-"}ms | tokens in/out ${m?.prompt_tokens ?? "-"}/${m?.completion_tokens ?? "-"} | cost $${cost(m?.prompt_tokens ?? null, m?.completion_tokens ?? null)} | ${JSON.stringify(summary)}`,
  );
}
