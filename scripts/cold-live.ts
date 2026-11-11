/**
 * One live cold check (final pass C4): a real Base payee that is NOT in the census, through the real server.
 * Spends at most 8 Surf credits (2 SQL calls), and 0 on the repeat. Settlement stays dry-run.
 * Usage: npx tsx scripts/cold-live.ts [url]   (default https://api.bitrefill.com/x402/gift-cards/search)
 */
import type { AddressInfo } from "node:net";
import { loadDotEnv } from "../src/config.js";
import { surfBalance } from "./audit.js";

loadDotEnv();
process.env.FIANGSHI_PAYTO ||= "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // EIP-55 spec vector, dry-run only
process.env.FIANGSHI_REPLAY = "0";
process.env.FIANGSHI_OFFLINE = "0";
process.env.MOCK_MODELS = "";
const { startServer } = await import("../src/api/server.js");
const { demoXPayment } = await import("../src/adapters/x402.js");
const url = process.argv[2] ?? "https://api.bitrefill.com/x402/gift-cards/search";
const server = await startServer(0, "127.0.0.1");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const get = async (h: Record<string, string> = {}) => (await fetch(`${base}/v1/check?url=${encodeURIComponent(url)}`, { headers: h, signal: AbortSignal.timeout(120_000) })).json() as Promise<any>;

try {
  const before = surfBalance();
  const q = await get();
  if (!q.accepts) throw new Error(`expected a 402, got ${JSON.stringify(q).slice(0, 200)}`);
  console.log(`402 asks ${Number(q.accepts[0].amount) / 1e6} USDC (cold SKU)`);
  const xp = { "x-payment": demoXPayment(q.accepts[0], "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359") };
  let t = performance.now();
  const a = await get(xp);
  const coldMs = Math.round(performance.now() - t);
  const mid = surfBalance();
  console.log(`cold:   band ${a.band} score ${a.score} vow ${a.vow_fired ?? "none"} | sku ${a.sku} | cold ${JSON.stringify(a.cold)} | ${coldMs} ms | receipt ${a.receipt_id}`);
  console.log(`        credits ${before} -> ${mid} (spent ${before !== null && mid !== null ? before - mid : "?"})`);
  const q2 = await get();
  t = performance.now();
  const b = await get({ "x-payment": demoXPayment(q2.accepts[0], "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359") });
  const warmMs = Math.round(performance.now() - t);
  const after = surfBalance();
  console.log(`repeat: 402 asks ${Number(q2.accepts[0].amount) / 1e6} USDC | band ${b.band} | sku ${b.sku} | cold source ${b.cold?.source} surf_calls ${b.cold?.surf_calls} | ${warmMs} ms | receipt ${b.receipt_id}`);
  console.log(`        credits ${mid} -> ${after} (spent ${mid !== null && after !== null ? mid - after : "?"})`);
} finally {
  server.close();
}
