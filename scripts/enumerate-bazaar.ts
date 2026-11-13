/**
 * Enumerate the public x402 Bazaar catalog (Coinbase CDP discovery). 0 credits, no key, 1 req/sec.
 * Writes data/bazaar/resources.jsonl (compact rows) and fixtures/bazaar/summary.json (committed counts).
 * Usage: npx tsx scripts/enumerate-bazaar.ts [--max-pages N]
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "../src/config.js";
const URL_ = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const LIMIT = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Accept { payTo?: string; network?: string; amount?: string; maxAmountRequired?: string; asset?: string; scheme?: string }
interface Item { resource?: string; serviceName?: string; description?: string; accepts?: Accept[]; lastUpdated?: string }

const maxPages = Number(process.argv[process.argv.indexOf("--max-pages") + 1]) || Infinity;
const dataDir = join(ROOT, "data", "bazaar");
mkdirSync(dataDir, { recursive: true });
const out = join(dataDir, "resources.jsonl");
writeFileSync(out, "");

let offset = 0;
let total = Infinity;
let pages = 0;
let rows = 0;
let errors = 0;
while (offset < total && pages < maxPages) {
  let j: { items?: Item[]; pagination?: { total?: number } };
  try {
    const res = await fetch(`${URL_}?limit=${LIMIT}&offset=${offset}`, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 429 || res.status >= 500) {
      // back off once, then give up on this page (no retry loops)
      await sleep(10_000);
      const again = await fetch(`${URL_}?limit=${LIMIT}&offset=${offset}`, { signal: AbortSignal.timeout(30_000) });
      if (!again.ok) throw new Error(`HTTP ${again.status}`);
      j = (await again.json()) as typeof j;
    } else {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      j = (await res.json()) as typeof j;
    }
  } catch (e) {
    errors++;
    console.log(`page offset=${offset} failed: ${(e as Error).message}`);
    if (errors >= 3) break;
    offset += LIMIT;
    continue;
  }
  total = j.pagination?.total ?? 0;
  const items = j.items ?? [];
  if (items.length === 0) break;
  const lines = items.map((it) => {
    const a = it.accepts?.[0] ?? {};
    return JSON.stringify({
      resource: it.resource ?? null,
      serviceName: it.serviceName ?? null,
      network: a.network ?? null,
      payTo: a.payTo ? a.payTo.toLowerCase() : null,
      amount: a.amount ?? a.maxAmountRequired ?? null,
      asset: a.asset ? a.asset.toLowerCase() : null,
      lastUpdated: it.lastUpdated ?? null,
    });
  });
  appendFileSync(out, lines.join("\n") + "\n");
  rows += items.length;
  pages++;
  offset += LIMIT;
  if (pages % 20 === 0) console.log(`pages=${pages} rows=${rows}/${total}`);
  await sleep(1000);
}
console.log(`done: pages=${pages} rows=${rows} total_reported=${total} page_errors=${errors} -> ${out}`);
