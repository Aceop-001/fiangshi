/**
 * Measure the public API's latency from the outside, the way a caller sees it, and write artifacts/latency-live.md.
 *
 *   npx tsx scripts/latency-live.ts [--base https://api.fiangshi.xyz] [--n 20] [--write]
 *
 * Each sample is one full request to GET /v1/preview, including the live unpaid probe of the seller. Paths measured:
 * a census payee (warm), the null-payee gate, and a URL that is not an x402 endpoint (probe failure). Requests run one
 * after another, so the numbers include no queueing. A post-sleep sample is taken only with --cold-start (it waits for
 * the free-tier instance to sleep first). Free endpoints only: 0 credits, no model calls.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";

const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : d);
const BASE = arg("--base", "https://api.fiangshi.xyz").replace(/\/$/, "");
const N = Math.max(5, Number(arg("--n", "20")));

const PATHS: [label: string, url: string][] = [
  ["census payee (warm)", "https://x402.tbs-digital.com/weather/current"],
  ["null-payee gate", "https://api.cleave.fi/x402/gas"],
  ["not an x402 endpoint", "https://example.com/"],
];

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

async function sample(url: string): Promise<{ ms: number; verdict: string }> {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/v1/preview?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(90_000) });
  const body = (await r.json()) as { verdict?: string };
  return { ms: performance.now() - t0, verdict: String(body.verdict) };
}

const rows: string[] = [];
const at = new Date().toISOString();
for (const [label, url] of PATHS) {
  await sample(url); // wake-up / connection warm-up, not counted
  const ms: number[] = [];
  let verdict = "";
  for (let i = 0; i < N; i++) {
    const s = await sample(url);
    ms.push(s.ms);
    verdict = s.verdict;
  }
  rows.push(`| ${label} | ${verdict} | ${N} | ${Math.round(pct(ms, 50))} | ${Math.round(pct(ms, 95))} | ${Math.round(Math.max(...ms))} |`);
  console.log(rows[rows.length - 1]);
}

const md = `# Live latency

Measured by \`npx tsx scripts/latency-live.ts --write\` against \`${BASE}\` at ${at}, from one client, requests in sequence.
Each sample is a full \`GET /v1/preview\` round trip, including the live unpaid probe of the seller's endpoint, so the
seller's own response time is part of every number. One warm-up request per path is not counted.

| path | answer | samples | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
${rows.join("\n")}

## Not measured here

- **Cold check** (a payee outside the census, via the paid \`/v1/check\`): one live run on 11 Nov took 10,772 ms
  (\`artifacts/cold-live.md\`). That is one sample, not a distribution. The public API does not run cold checks yet.
- **First request after the free-tier instance sleeps**: Render starts it on demand, which takes up to about a minute.

## Timeout contract

| stage | limit | what the caller gets when it is exceeded |
|---|---|---|
| unpaid probe of the seller | 15 s | \`no_verdict\` with \`probe failed\` (never ALLOW) |
| SERV model advice (paid check) | 15 s, one stricter retry | REVIEW, \`degraded: true\` |
| Dolphin name extraction (paid check) | 12 s, one retry | band unchanged, \`enrichment: incomplete\` |
| Surf cold lookup (paid check) | 25 s per call (\`FIANGSHI_SURF_CALL_TIMEOUT_MS\`; 60 s if unset) | REVIEW with \`surf_error\` on the receipt |

A free check therefore answers within about 15 s plus network time once the server is awake, and a paid check within
about a minute plus the Surf calls in the worst case. Whatever the delay, a timeout produces REVIEW or no verdict, never ALLOW.
`;
if (process.argv.includes("--write")) writeFileSync(join(ROOT, "artifacts", "latency-live.md"), md);
