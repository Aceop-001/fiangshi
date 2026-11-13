/**
 * Localhost end-to-end check. Starts the API on 127.0.0.1:8787 (child process), runs 10 assertions, prints a
 * PASS/FAIL table, exits non-zero on any failure.
 *
 *   npm run localhost-check             FIXTURE mode (default, zero keys): recorded 402s and recorded SERV/Dolphin replies
 *                                       (fixtures/402/real, fixtures/recorded) replayed through the REAL parser, vows and
 *                                       receipt chain. The server runs under the no-network preload: 127.0.0.1 only.
 *   npm run localhost-check -- --live   LIVE mode: real unpaid probes, real SERV (needs SERV_REASONING_API_KEY) and Dolphin.
 *                                       Writes artifacts/demo-stats.json (the index footer's latency).
 * 0 Surf credits either way. Settlement is dry-run; the X-PAYMENT used here is a structurally valid placeholder
 * (src/adapters/x402.ts demoXPayment), never a real signature.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { referenceTime } from "../src/reference-time.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadDotEnv } from "../src/config.js";
import { parse402 } from "../src/adapters/probe.js";
import { demoXPayment, type Requirement } from "../src/adapters/x402.js";

const LIVE = process.argv.includes("--live");
const MODE = LIVE ? "live" : "fixture";
const SHELL_ENV = { ...process.env }; // tests/accept run with the caller's env, NOT .env (keys and live timeouts stay out of tests)
if (LIVE) loadDotEnv(); // fixture mode never reads .env: no keys are needed or used
const PORT = Number(process.env.FIANGSHI_CHECK_PORT ?? 8787); // override only if 8787 is taken (e.g. by npm run dev)
const BASE = `http://127.0.0.1:${PORT}`;
const CLEAVE = "https://api.cleave.fi/x402/gas";
const ALLOW_URL = "https://x402.tbs-digital.com/weather/current"; // TBS Weather & Climate API, census ALLOW, name corroborated
const DEMO_PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // EIP-55 spec vector: dry-run only, receives nothing
const DEMO_FROM = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"; // EIP-55 spec vector
const payTo = (LIVE && (process.env.FIANGSHI_PAYTO ?? "").trim()) || DEMO_PAYTO;

const bar = "=".repeat(78);
console.log(
  LIVE
    ? `${bar}\nLIVE MODE: real unpaid probes, real SERV and Dolphin calls (keys from .env).\n${bar}`
    : `${bar}\nFIXTURE MODE (default): recorded provider responses replayed through the real\nparser, vows and receipt chain. No keys. No network except 127.0.0.1.\nEvery response is marked mode:"fixture". Live providers: npm run localhost-check -- --live\n${bar}`,
);

interface Row { step: string; ok: boolean; ms: number; detail: string }
const rows: Row[] = [];
async function step(name: string, fn: () => Promise<string>) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    rows.push({ step: name, ok: true, ms: Math.round(performance.now() - t0), detail });
  } catch (e) {
    rows.push({ step: name, ok: false, ms: Math.round(performance.now() - t0), detail: (e as Error).message.slice(0, 160) });
  }
}
const assert = (c: unknown, msg: string) => {
  if (!c) throw new Error(msg);
};
async function get(path: string, headers: Record<string, string> = {}) {
  const r = await fetch(BASE + path, { headers, signal: AbortSignal.timeout(90_000) });
  const body = await r.text();
  const h = Object.fromEntries(r.headers.entries());
  assert(h["x-fiangshi-mode"] === MODE, `${path}: response mode ${h["x-fiangshi-mode"]}, expected ${MODE}`);
  return { status: r.status, headers: h, body };
}
/** JSON responses carry the mode in the body too. */
const body = (r: { body: string }) => {
  const j = JSON.parse(r.body);
  assert(j.mode === MODE, `body mode ${j.mode}, expected ${MODE}`);
  return j;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function startServer(): Promise<ChildProcess> {
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`port ${PORT} is already in use: stop the other server (npm run dev) first`);
  } catch (e) {
    if ((e as Error).message.startsWith("port")) throw e;
  }
  const common = { PORT: String(PORT), HOST: "127.0.0.1", FIANGSHI_PAYTO: payTo, NODE_NO_WARNINGS: "1" };
  const env = LIVE
    ? { ...process.env, ...common, FIANGSHI_REPLAY: "0", FIANGSHI_OFFLINE: "0", SNAPSHOT_SOURCE: "live", MOCK_MODELS: "" }
    : {
        ...SHELL_ENV,
        ...common,
        FIANGSHI_REPLAY: "1",
        FIANGSHI_OFFLINE: "1",
        FIANGSHI_NOW: process.env.FIANGSHI_NOW ?? referenceTime(), // fixture mode replays a recorded moment
        MOCK_MODELS: "",
        SERV_REASONING_API_KEY: "",
        DOLPHIN_API_KEY: "",
        SURF_API_KEY: "",
        FIANGSHI_DATA_DIR: join(mkdtempSync(join(tmpdir(), "fiangshi-fixture-")), "data"), // no local caches, no ledger in data/
      };
  const preload = LIVE ? [] : [`--import=${pathToFileURL(join(ROOT, "scripts", "no-network.mjs")).href}`];
  const child = spawn(process.execPath, [...preload, "--import", "tsx", "src/api/server.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr!.on("data", (d) => (err += d));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${err.slice(0, 300)}`);
    try {
      if ((await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) })).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error("server did not answer /health within 20 s");
}

const run = (cmd: string) => spawnSync(cmd, { cwd: ROOT, shell: true, encoding: "utf8", env: { ...SHELL_ENV, NODE_NO_WARNINGS: "1", NO_COLOR: "1", FORCE_COLOR: "0" }, maxBuffer: 1 << 26 });

let server: ChildProcess | null = null;
let requirement: Requirement | null = null;
let receiptId = "";
let coldMs: number | null = null;
let warmP50: number | null = null;
let testsPassed = 0;
let acceptLine = "";

try {
  server = await startServer();
  console.log(`server up on ${BASE} (payTo ${payTo === DEMO_PAYTO ? "dry-run demo vector" + (LIVE ? "; set FIANGSHI_PAYTO for yours" : "") : "from FIANGSHI_PAYTO"})`);
  if (LIVE && !process.env.SERV_REASONING_API_KEY) console.log("note: SERV_REASONING_API_KEY is not set: SERV fails closed, so step 5 will be REVIEW (degraded), not ALLOW");

  await step("1 GET /health -> 200", async () => {
    const r = await get("/health");
    assert(r.status === 200, `status ${r.status}`);
    return `census_payees=${body(r).census_payees}`;
  });

  await step("2 /v1/index.json: 800 payees, bands sum", async () => {
    const j = body(await get("/v1/index.json"));
    const sum = j.bands.ALLOW + j.bands.REVIEW + j.bands.BLOCK;
    assert(j.payees.length === 800 && sum === 800, `payees ${j.payees.length}, band sum ${sum}`);
    return `ALLOW ${j.bands.ALLOW} / REVIEW ${j.bands.REVIEW} / BLOCK ${j.bands.BLOCK}`;
  });

  await step("3 check cleave.fi -> BLOCK, $0, 0 model calls", async () => {
    const r = await get(`/v1/check?url=${encodeURIComponent(CLEAVE)}`);
    assert(r.status === 200, `status ${r.status}: ${r.body.slice(0, 120)}`);
    const j = body(r);
    assert(j.band === "BLOCK" && j.cost_usd === 0 && j.model_calls === 0, `band ${j.band}, cost ${j.cost_usd}, model_calls ${j.model_calls}`);
    return `vow ${j.vow_fired}, receipt ${String(j.receipt_id).slice(0, 12)}…`;
  });

  await step("4 check ALLOW payee unpaid -> 402, parses", async () => {
    const r = await get(`/v1/check?url=${encodeURIComponent(ALLOW_URL)}`);
    assert(r.status === 402, `status ${r.status}: ${r.body.slice(0, 120)}`);
    const b = body(r);
    const p = parse402({ url: ALLOW_URL, status: 402, headers: r.headers, body: b });
    assert(p.ok, `our parser rejected the 402: ${p.ok ? "" : p.error}`);
    requirement = b.accepts[0] as Requirement;
    return `accepts[0] ${requirement.amount} atomic USDC to ${requirement.payTo.slice(0, 10)}…`;
  });

  await step("5 same with X-PAYMENT -> 200 ALLOW (or stale-capped REVIEW) + receipt", async () => {
    assert(requirement, "no requirement from step 4");
    const t0 = performance.now();
    const r = await get(`/v1/check?url=${encodeURIComponent(ALLOW_URL)}`, { "x-payment": demoXPayment(requirement!, DEMO_FROM) });
    coldMs = Math.round(performance.now() - t0);
    assert(r.status === 200, `status ${r.status}: ${r.body.slice(0, 120)}`);
    const j = body(r);
    // policy v5: in live mode a census record older than the limit is honestly capped at REVIEW (band_cap data_stale)
    assert(j.band === "ALLOW" || (j.band === "REVIEW" && j.band_cap?.reason === "data_stale"), `band ${j.band} (vow ${j.vow_fired}, model ${j.model?.serv}, degraded ${j.model?.degraded}, cap ${j.band_cap?.reason})`);
    assert(/^[0-9a-f]{64}$/.test(j.receipt_id), "no receipt id");
    receiptId = j.receipt_id;
    return `score ${j.score}, SERV ${j.model.serv}, enrichment ${j.enrichment?.status}, settlement ${j.settlement}`;
  });

  await step("6 verify receipt true; one flipped byte false", async () => {
    assert(receiptId, "no receipt from step 5");
    const v = body(await get(`/v1/verify?id=${receiptId}`));
    assert(v.valid === true, `valid ${v.valid}: ${v.errors}`);
    const rec = body(await get(`/v1/receipt/${receiptId}`)).receipt;
    const s = JSON.stringify(rec);
    const i = s.indexOf('"score":') + 8;
    const flipped = s.slice(0, i) + (s[i] === "9" ? "8" : "9") + s.slice(i + 1);
    const bad = body(await get(`/v1/verify?receipt=${Buffer.from(flipped).toString("base64url")}`));
    assert(bad.valid === false, "tampered receipt verified");
    return `chain ${v.chain}; tampered: ${String(bad.errors?.[0] ?? "").slice(0, 50)}`;
  });

  await step("7 badge -> 200 image/svg+xml", async () => {
    const r = await get(`/v1/badge/0xd6fce15298fc9d60f867d9455d497177da9bfb0a.svg`);
    assert(r.status === 200 && /image\/svg\+xml/.test(r.headers["content-type"] ?? ""), `status ${r.status}, ${r.headers["content-type"]}`);
    return `${r.body.length} bytes`;
  });

  await step("8 GET / -> headline counts + cleave.fi", async () => {
    const r = await get("/");
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.includes("800 of 1,923 Base payees, 90-day window"), "headline missing");
    assert(r.body.includes("cleave.fi"), "cleave.fi card missing");
    assert(!/<script/i.test(r.body), "page contains <script>");
    assert(LIVE || r.body.includes("Fixture mode."), "fixture banner missing");
    return `headline, both cards, no <script>${LIVE ? "" : ", fixture banner"}`;
  });

  await step("9 warm p50 of /v1/check over 3 calls", async () => {
    const ts: number[] = [];
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      const r = await get(`/v1/check?url=${encodeURIComponent(ALLOW_URL)}`, { "x-payment": demoXPayment(requirement!, DEMO_FROM) });
      ts.push(Math.round(performance.now() - t0));
      assert(r.status === 200, `status ${r.status}`);
    }
    warmP50 = median(ts);
    return `p50 ${warmP50} ms (${ts.join(", ")} ms)${LIVE ? "" : " [fixture: no provider latency]"}`;
  });

  await step("10 accept all gates + tests green, server running", async () => {
    const t = run("npx vitest run");
    const m = /Tests\s+(\d+) passed/.exec(t.stdout);
    testsPassed = m ? Number(m[1]) : 0;
    const failed = [...t.stdout.matchAll(/^\s*(?:FAIL|×)\s+(.+)$/gm)].map((x) => x[1]).slice(0, 3).join("; ");
    assert(t.status === 0 && testsPassed > 0, `vitest exit ${t.status}: ${failed || t.stdout.slice(-200)}`);
    const a = run("npm run accept");
    acceptLine = /(\d+\/\d+) PASS/.exec(a.stdout)?.[1] ?? "?";
    const [okN = 0, allN = -1] = acceptLine.split("/").map(Number);
    assert(a.status === 0 && okN === allN && allN >= 15, `accept exit ${a.status}, ${acceptLine}`);
    return `${testsPassed} tests passed; accept ${acceptLine}`;
  });
} catch (e) {
  rows.push({ step: "server", ok: false, ms: 0, detail: (e as Error).message });
} finally {
  server?.kill();
}

const pass = rows.filter((r) => r.ok).length;
console.log(`\nmode: ${MODE}\n\n| # | step | result | ms | detail |\n|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.step.split(" ")[0]} | ${r.step.slice(r.step.indexOf(" ") + 1)} | ${r.ok ? "PASS" : "FAIL"} | ${r.ms} | ${r.detail.replace(/\|/g, "/")} |`);
console.log(`\n${pass}/10 PASS (${MODE} mode)`);

if (LIVE && pass === 10 && warmP50 !== null) {
  const stats = { measured_at: new Date().toISOString(), warm_p50_ms: warmP50, cold_ms: coldMs, tests_passed: testsPassed, accept: acceptLine };
  writeFileSync(join(ROOT, "artifacts", "demo-stats.json"), JSON.stringify(stats, null, 2) + "\n");
  console.log("wrote artifacts/demo-stats.json");
}
console.log(`\nTry it yourself (npm run dev serves http://127.0.0.1:8787; fixture mode with the default .env):\n  npm run dev\n  curl "http://127.0.0.1:8787/v1/check?url=${encodeURIComponent(CLEAVE)}"`);
process.exit(pass === 10 ? 0 : 1);
