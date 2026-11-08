/**
 * Record real unpaid 402 responses. ONE GET per URL, 1 req/sec, at most one redirect followed.
 * Usage: npx tsx scripts/probe-real.ts <candidates.json>   ([{url}, ...])
 * Writes fixtures/402/real/<host>.json as {url, status, headers, body}. Zero credits (no Surf calls).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "..", "fixtures", "402", "real");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getOnce(url: string): Promise<{ url: string; status: number; headers: Record<string, string>; body: unknown }> {
  let target = url;
  for (let hop = 0; hop < 2; hop++) {
    const res = await fetch(target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    const loc = res.headers.get("location");
    if (hop === 0 && res.status >= 300 && res.status < 400 && loc) {
      target = new URL(loc, target).href;
      continue;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const text = await res.text();
    let body: unknown = text.slice(0, 20_000);
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { url, status: res.status, headers, body };
  }
  throw new Error("unreachable");
}

const cands = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { url: string }[];
mkdirSync(OUT, { recursive: true });
for (const c of cands) {
  try {
    const r = await getOnce(c.url);
    writeFileSync(join(OUT, `${new URL(c.url).host}.json`), JSON.stringify(r, null, 2) + "\n");
    console.log(`${r.status}  ${c.url}`);
  } catch (e) {
    console.log(`ERR  ${c.url}  ${(e as Error).message}`);
  }
  await sleep(1000);
}
