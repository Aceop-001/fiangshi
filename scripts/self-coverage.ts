/**
 * H (post-deadline): the service's own payTo from Base chain logs, with zero Surf credits.
 * Build-time job, never on the request path. Reads USDC Transfer logs to and from the payTo over the census window
 * (90 days) from a public Base RPC, and writes fixtures/self-coverage.json with `as_of` and every transaction hash, so
 * each number can be checked against a block explorer. The server reads that file once at startup.
 *
 *   npx tsx scripts/self-coverage.ts [--payee 0x…] [--days 90] [--rpc https://mainnet.base.org]
 *
 * RPC limits, learned the hard way: eth_getLogs is capped at 50,000 blocks per call, and more than 4 concurrent calls
 * trips rate limits. So: 50k chunks, concurrency 4, 4 retries with backoff, 20 s per call.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { CENSUS_DAYS } from "../src/census.js";
import { SELF_COVERAGE_FILE, SELF_PAYEE, USDC_BASE, type SelfCoverageFile, type LogTransfer } from "../src/self-coverage.js";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const RPC = arg("--rpc", "https://base-rpc.publicnode.com");
/** Archive node, used only for the two pre-window state reads (it rate-limits log scans). */
const ARCHIVE = arg("--archive-rpc", "https://mainnet.base.org");
const PAYEE_ARG = arg("--payee", SELF_PAYEE);
const PAYEE = PAYEE_ARG.toLowerCase();
const DAYS = Number(arg("--days", String(CENSUS_DAYS)));
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer(address,address,uint256)
const CHUNK = 50_000;
const CONCURRENCY = 4;
const RETRIES = 4;
const pad = (a: string) => "0x" + a.slice(2).padStart(64, "0");
const hex = (n: number) => "0x" + n.toString(16);

let id = 0;
let calls = 0;
async function rpc<T>(method: string, params: unknown[], url = RPC, retries = RETRIES): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // backoff 2, 4, 8, 16 s; a rate-limit answer waits 4x longer. A range or archive refusal is final: no retry.
    if (attempt) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1) * (/limit/i.test(String((last as Error)?.message)) ? 4 : 1)));
    calls++;
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(20_000) });
      const j = (await r.json()) as { result?: T; error?: unknown };
      if (j.error) throw Object.assign(new Error(JSON.stringify(j.error)), { final: /archive|range/i.test(JSON.stringify(j.error)) });
      if (j.result === null || j.result === undefined) throw Object.assign(new Error(`${method}: null result`), { final: true });
      return j.result as T;
    } catch (e) {
      last = e;
      if ((e as { final?: boolean }).final) break;
    }
  }
  throw new Error(`${method} failed: ${String((last as Error)?.message ?? last).slice(0, 200)}`);
}

type Log = { blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string };

async function scan(topics: (string | null)[], from: number, to: number, label: string): Promise<Log[]> {
  const chunks: [number, number][] = [];
  for (let a = from; a <= to; a += CHUNK) chunks.push([a, Math.min(to, a + CHUNK - 1)]);
  const out: Log[][] = new Array(chunks.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= chunks.length) return;
      const [a, b] = chunks[i]!;
      out[i] = await rpc<Log[]>("eth_getLogs", [{ address: USDC_BASE, topics, fromBlock: hex(a), toBlock: hex(b) }]);
      done++;
      if (done % 10 === 0 || done === chunks.length) process.stdout.write(`${label}: ${done}/${chunks.length} chunks\n`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out.flat();
}

const latest = parseInt(await rpc<string>("eth_blockNumber", []), 16);
const blockTime = async (n: number | string, url = RPC) => parseInt((await rpc<{ timestamp: string }>("eth_getBlockByNumber", [typeof n === "number" ? hex(n) : n, false], url)).timestamp, 16);
const serves = async (n: number) => blockTime(n).then(() => true, () => false);
const latestT = await blockTime(latest);
// Window: the census window (DAYS) or, when the RPC keeps less history, its horizon. Block time is not constant on
// Base (2 s earlier, 0.2 s now), so both ends come from binary searches on real blocks, never from an assumed rate.
let lo = 0;
let hi = latest;
if (!(await serves(lo))) {
  while (hi - lo > 1_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (await serves(mid)) hi = mid;
    else lo = mid;
  }
} else hi = 0;
const horizon = hi + 1_000; // a margin above the oldest block it serves
const target = latestT - DAYS * 86_400;
let a0 = horizon;
let b0 = latest;
if ((await blockTime(a0)) < target) {
  while (b0 - a0 > 100) {
    const mid = Math.floor((a0 + b0) / 2);
    if ((await blockTime(mid)) < target) a0 = mid;
    else b0 = mid;
  }
}
const from = b0 === latest ? horizon : b0;
const fromT = await blockTime(from);
const windowDays = Math.round(((latestT - fromT) / 86_400) * 100) / 100;
const limitedBy = windowDays < DAYS - 0.5 ? `the RPC serves no older history (archive requests need a token): ${windowDays} of ${DAYS} days scanned` : null;
console.log(`latest ${latest} (${new Date(latestT * 1000).toISOString()}), window from ${from} (${new Date(fromT * 1000).toISOString()}), ${windowDays} days, ${Math.ceil((latest - from + 1) / CHUNK)} chunks per direction${limitedBy ? `; ${limitedBy}` : ""}`);

// State at the window start, from the archive node: activity before the window would show as a nonce or a balance.
const before = async <T>(f: () => Promise<T>): Promise<T | null> => f().catch((e) => (console.log(`pre-window read failed: ${(e as Error).message}`), null));
const priorNonce = await before(async () => parseInt(await rpc<string>("eth_getTransactionCount", [PAYEE, hex(from)], ARCHIVE), 16));
const priorUsdc = await before(async () => Number(BigInt(await rpc<string>("eth_call", [{ to: USDC_BASE, data: "0x70a08231" + PAYEE.slice(2).padStart(64, "0") }, hex(from)], ARCHIVE))) / 1e6);
console.log(`at block ${from}: nonce ${priorNonce}, USDC ${priorUsdc}`);

const code = await rpc<string>("eth_getCode", [PAYEE, "latest"]);
const nonce = parseInt(await rpc<string>("eth_getTransactionCount", [PAYEE, "latest"]), 16);
const inLogs = await scan([TOPIC, null, pad(PAYEE)], from, latest, "inbound");
const outLogs = await scan([TOPIC, pad(PAYEE)], from, latest, "outbound");

const times = new Map<string, number>();
for (const l of [...inLogs, ...outLogs]) if (!times.has(l.blockNumber)) times.set(l.blockNumber, await blockTime(l.blockNumber));
const row = (l: Log, other: string): LogTransfer => ({
  block: parseInt(l.blockNumber, 16),
  time: new Date(times.get(l.blockNumber)! * 1000).toISOString(),
  counterparty: "0x" + other.slice(26),
  usd: Number(BigInt(l.data)) / 1e6,
  tx: l.transactionHash,
  log_index: parseInt(l.logIndex, 16),
});
const byBlock = (a: LogTransfer, b: LogTransfer) => a.block - b.block || a.log_index - b.log_index;

const file: SelfCoverageFile = {
  payee: PAYEE_ARG, // as given (checksummed); queries use the lowercase form
  chain: "eip155:8453",
  asset: USDC_BASE,
  source: "base-logs",
  rpc: RPC,
  as_of: new Date(latestT * 1000).toISOString(),
  window_days: windowDays,
  window_start: new Date(fromT * 1000).toISOString(),
  window_limited_by: limitedBy,
  archive_rpc: ARCHIVE,
  prior_nonce: priorNonce,
  prior_usdc: priorUsdc,
  from_block: from,
  to_block: latest,
  chunk_blocks: CHUNK,
  rpc_calls: calls,
  has_code: code !== "0x",
  nonce,
  inbound: inLogs.map((l) => row(l, l.topics[1]!)).sort(byBlock),
  outbound: outLogs.map((l) => row(l, l.topics[2]!)).sort(byBlock),
};
writeFileSync(join(ROOT, SELF_COVERAGE_FILE), JSON.stringify(file, null, 2) + "\n");
const usd = file.inbound.reduce((n, r) => n + r.usd, 0);
console.log(`\n${PAYEE}: ${file.inbound.length} inbound (${new Set(file.inbound.map((r) => r.counterparty)).size} payers, ${usd.toFixed(6)} USDC), ${file.outbound.length} outbound; code ${file.has_code ? "yes" : "none"}, nonce ${nonce}; ${calls} RPC calls, 0 Surf credits`);
console.log(`wrote ${SELF_COVERAGE_FILE}`);
