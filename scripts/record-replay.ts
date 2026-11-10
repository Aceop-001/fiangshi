/**
 * Records the provider responses that `npm run localhost-check` (fixture mode) replays. 0 Surf credits, 0 model calls:
 *  - raw unpaid 402s for the demo URLs -> fixtures/402/real/<host>.json (one live unpaid GET each; never overwrites)
 *  - the SERV verdict already cached by a live check -> fixtures/recorded/serv/<servReplayKey: hash(payee, terms_hash, evidence)>.json {model, text}
 *  - the Dolphin extraction already cached by a live check -> fixtures/recorded/dolphin/<sha256(listing text)>.json
 * Run a live check first (`npm run localhost-check -- --live`) so the caches exist.
 * Usage: npx tsx scripts/record-replay.ts
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, dataDir, env, loadDotEnv } from "../src/config.js";
import { parse402 } from "../src/adapters/probe.js";
import { hashOf, sha256 } from "../src/core/canonical.js";
import { servReplayKey } from "../src/adapters/serv.js";
import { loadCensus } from "../src/census.js";

loadDotEnv();
const URLS = ["https://api.cleave.fi/x402/gas", "https://x402.tbs-digital.com/weather/current"];
const rec = join(ROOT, "fixtures", "recorded");
mkdirSync(join(rec, "serv"), { recursive: true });
mkdirSync(join(rec, "dolphin"), { recursive: true });
const c = loadCensus();

for (const url of URLS) {
  const file = join(ROOT, "fixtures", "402", "real", `${new URL(url).host}.json`);
  if (!existsSync(file)) {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    const text = await r.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    writeFileSync(file, JSON.stringify({ url, status: r.status, headers, body, recorded_at: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
    console.log(`recorded 402 ${file}`);
  }
  const p = parse402(JSON.parse(readFileSync(file, "utf8")));
  if (!p.ok) {
    console.log(`${url}: recorded 402 does not parse (${p.error})`);
    continue;
  }
  const cp = c.payees.find((x) => x.payee === p.terms.payee);
  const model = env("SERV_MODEL", "unset");
  const signals = c.signals.get(p.terms.payee);
  if (!signals) {
    console.log(`${url}: payee not in the census, no SERV reply to record`);
    continue;
  }
  const cached = join(dataDir(), "cache", "serv", `${hashOf({ payee: p.terms.payee, terms_hash: p.terms.terms_hash, evidence: signals.evidence, model })}.json`);
  const servOut = join(rec, "serv", `${servReplayKey({ terms: p.terms, signals })}.json`);
  if (existsSync(cached) && !existsSync(servOut)) {
    const { text } = JSON.parse(readFileSync(cached, "utf8")) as { text: string };
    writeFileSync(servOut, JSON.stringify({ url, payee: p.terms.payee, terms_hash: p.terms.terms_hash, model, text }, null, 2) + "\n");
    console.log(`recorded SERV ${servOut}`);
  } else console.log(`${url}: SERV ${existsSync(servOut) ? "already recorded" : "no cached live verdict (V6 payees never reach SERV)"}`);
  const listing = cp?.service?.trim();
  if (listing) {
    const src = join(dataDir(), "cache", "dolphin", `${sha256(listing)}.json`);
    const out = join(rec, "dolphin", `${sha256(listing)}.json`);
    if (existsSync(src) && !existsSync(out)) {
      copyFileSync(src, out);
      console.log(`recorded Dolphin ${out}`);
    } else console.log(`${url}: Dolphin ${existsSync(out) ? "already recorded" : "no cached live extraction"}`);
  }
}
