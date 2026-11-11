/**
 * npm run accept — the offline acceptance gate. 11 gates, PASS/FAIL per line, exit 1 on any FAIL.
 * Zero network: this process and every child run with scripts/no-network.mjs, which throws on any outbound call.
 * All writes go to a temp dir; ./data and ./artifacts are untouched.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../src/config.js";

const TMP = mkdtempSync(join(tmpdir(), "fiangshi-accept-"));
Object.assign(process.env, {
  FIANGSHI_OFFLINE: "1",
  SNAPSHOT_SOURCE: "fixture",
  MOCK_MODELS: "good",
  FIANGSHI_REPLAY: "0", // accept tests mocks + fixtures; replay mode is exercised by tests/fixture-mode.test.ts
  FIANGSHI_DATA_DIR: join(TMP, "data"),
  FIANGSHI_ARTIFACTS_DIR: join(TMP, "artifacts"),
});
const NO_NET = pathToFileURL(join(ROOT, "scripts", "no-network.mjs")).href;
await import(NO_NET);
const childEnv = { ...process.env, NODE_OPTIONS: `--import=${NO_NET}`, NODE_NO_WARNINGS: "1" };

// imported after the network is blocked
const { loadFixtures402, parse402 } = await import("../src/adapters/probe.js");
const { buildSnapshot, writeSnapshot } = await import("../src/snapshot.js");
const { check } = await import("../src/check.js");
const { verifyChain } = await import("../src/core/receipt.js");
const { readLedger } = await import("../src/ledger/store.js");
const { guarded, BudgetExceeded } = await import("./budget.js");
const { buildIndex } = await import("./build-index.js");

interface Row {
  gate: string;
  ok: boolean;
  ms: number;
  notes: string;
}
const rows: Row[] = [];

async function gate(name: string, fn: () => Promise<string> | string) {
  const t0 = performance.now();
  let ok = true;
  let notes = "";
  try {
    notes = await fn();
  } catch (e) {
    ok = false;
    notes = (e as Error).message.split("\n")[0]!.slice(0, 160);
  }
  const ms = Math.round(performance.now() - t0);
  rows.push({ gate: name, ok, ms, notes });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(40)} ${String(ms).padStart(6)}ms  ${notes}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: ROOT, env: childEnv, encoding: "utf8", shell: false });
const nodeBin = process.execPath;

const t0 = performance.now();
console.log(`fiangshi accept — offline, temp dir ${TMP}\n`);

await gate("G1 typecheck clean (+ build dist)", () => {
  const r = run(nodeBin, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"]);
  assert(r.status === 0, (r.stdout + r.stderr).trim() || "tsc failed");
  return "tsc strict, 0 errors";
});

await gate("G2 npm test green (>=30 cases, no network)", () => {
  const out = join(TMP, "vitest.json");
  const r = run(nodeBin, [join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", "--reporter=json", `--outputFile=${out}`]);
  const j = JSON.parse(readFileSync(out, "utf8")) as { numPassedTests: number; numFailedTests: number; numTotalTests: number };
  assert(r.status === 0 && j.numFailedTests === 0, `${j.numFailedTests} failing tests`);
  assert(j.numPassedTests >= 30, `only ${j.numPassedTests} tests`);
  return `${j.numPassedTests}/${j.numTotalTests} passed`;
});

await gate("G3 probe parses 10/10 fixtures", () => {
  const all = loadFixtures402();
  const ok = all.map(parse402).filter((r) => r.ok).length;
  assert(all.length === 10 && ok === 10, `${ok}/${all.length} parsed`);
  return `${ok}/${all.length} parsed`;
});

await gate("G4 fixture snapshot stable snapshot_id x2", async () => {
  const a = await buildSnapshot();
  const b = await buildSnapshot();
  assert(a.snapshot.snapshot_id === b.snapshot.snapshot_id, "snapshot_id differs between builds");
  writeSnapshot(a.snapshot);
  return `${a.snapshot.snapshot_id.slice(0, 16)}… data_calls=${a.calls + b.calls}`;
});

await gate("G5 check offline <300ms (compiled CLI, wall)", () => {
  const cli = join(ROOT, "dist", "src", "cli", "index.js");
  const url = "https://api.weatherly.example/v1/forecast";
  run(nodeBin, [cli, "check", url]); // warm the OS file cache
  const t = performance.now();
  const r = run(nodeBin, [cli, "check", url, "--json"]);
  const wall = Math.round(performance.now() - t);
  assert(r.status === 0, (r.stderr || r.stdout).trim());
  const j = JSON.parse(r.stdout) as { verdict: { band: string }; ms: number };
  assert(wall < 300, `wall ${wall}ms >= 300ms (in-process ${j.ms}ms)`);
  return `wall ${wall}ms, in-process ${j.ms}ms, band ${j.verdict.band}`;
});

await gate("G6 vow beats model ALLOW", async () => {
  process.env.MOCK_MODELS = "allow";
  try {
    const r = await check("https://fresh-oracle.example/v1/price", { ledger: false });
    assert(r.decision.modelRawBand === "ALLOW", `model said ${r.decision.modelRawBand}`);
    assert(r.decision.verdict.band === "BLOCK", `final ${r.decision.verdict.band}`);
    return `model ALLOW -> final BLOCK (vow ${r.decision.verdict.vow_fired})`;
  } finally {
    process.env.MOCK_MODELS = "good";
  }
});

await gate("G7 receipt verify + tamper detection", async () => {
  const path = join(TMP, "g7-ledger.jsonl");
  for (const u of ["https://api.weatherly.example/v1/forecast", "https://swarm-a.example/v1/search", "https://unknown-seller.example/v1/data"])
    await check(u, { ledger: path });
  const all = readLedger(path) as Record<string, unknown>[];
  assert(verifyChain(all).ok, "clean chain did not verify");
  const fields = Object.keys(all[1]!).filter((k) => k !== "receipt_hash");
  const missed = fields.filter((k) => {
    const t = all.map((r) => ({ ...r }));
    t[1]![k] = typeof t[1]![k] === "number" ? (t[1]![k] as number) + 1 : k === "evidence" ? [] : k === "model" ? {} : "tampered";
    return verifyChain(t).ok;
  });
  assert(missed.length === 0, `tamper undetected on: ${missed.join(",")}`);
  // CLI verify on a tampered ledger file must exit non-zero
  const bad = all.map((r) => JSON.stringify(r)).join("\n").replace('"band":"BLOCK"', '"band":"ALLOW"');
  writeFileSync(join(TMP, "tampered.jsonl"), bad + "\n");
  const r = run(nodeBin, [join(ROOT, "dist", "src", "cli", "index.js"), "verify", join(TMP, "tampered.jsonl")]);
  assert(r.status === 1, `CLI verify exit ${r.status} on tampered ledger`);
  return `chain of ${all.length} ok; ${fields.length}/${fields.length} fields tamper-evident; CLI exit 1`;
});

await gate("G8 MOCK_MODELS=broken -> REVIEW, degraded", async () => {
  process.env.MOCK_MODELS = "broken";
  try {
    const r = await check("https://api.weatherly.example/v1/forecast", { ledger: false });
    assert(r.decision.verdict.band === "REVIEW" && r.decision.verdict.degraded, `got ${r.decision.verdict.band} degraded=${r.decision.verdict.degraded}`);
    return `clean payee -> REVIEW degraded=true after ${r.decision.attempts} attempts`;
  } finally {
    process.env.MOCK_MODELS = "good";
  }
});

await gate("G9 budget guard refuses call N+1", async () => {
  const N = 5;
  const opts = { counterPath: join(TMP, "g9-budget.json"), costsPath: join(TMP, "g9-costs.md"), cap: N, ignoreOffline: true };
  let ran = 0;
  for (let i = 0; i < N; i++) await guarded("surf", "g9", async () => ({ value: ++ran }), opts);
  let refused = false;
  try {
    await guarded("surf", "g9", async () => ({ value: ++ran }), opts);
  } catch (e) {
    refused = e instanceof BudgetExceeded;
  }
  assert(refused && ran === N, `refused=${refused} ran=${ran}`);
  return `${N} allowed, call ${N + 1} refused, fn not executed`;
});

await gate("G10 index builds, >=25 payees, no JS", async () => {
  const { path, rows: n } = await buildIndex(join(TMP, "site"));
  const html = readFileSync(path, "utf8");
  const trs = (html.match(/<tr class=/g) ?? []).length;
  assert(n >= 25 && trs >= 25, `${n} payees`);
  assert(!/<script/i.test(html) && !/\son[a-z]+=/i.test(html), "index contains JS");
  return `${n} payees, ${trs} rows, 0 <script>`;
});

await gate("G11 fixtures/402/real intact, all parse", () => {
  const dir = join(ROOT, "fixtures", "402", "real");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const empty = files.filter((f) => statSync(join(dir, f)).size === 0);
  assert(files.length >= 12, `only ${files.length} real 402 fixtures (need >= 12)`);
  assert(empty.length === 0, `empty fixtures: ${empty.join(",")}`);
  const bad = loadFixtures402(dir).map(parse402).filter((r) => !r.ok);
  assert(bad.length === 0, `${bad.length} real fixtures fail to parse`);
  return `${files.length} files, ${files.length - bad.length} parse, 0 empty`;
});

await gate("G12 numbers consistency (docs vs data/numbers.json)", async () => {
  const { computeNumbers, checkDocs } = await import("./numbers.js");
  const n = computeNumbers();
  const bad = checkDocs(n);
  assert(bad.length === 0, `${bad.length} disagreement(s): ${bad.slice(0, 2).join(" ; ")}`);
  assert(n.bands.ALLOW + n.bands.REVIEW + n.bands.BLOCK === n.census.payees, "bands do not sum to the census size");
  return `bands ${n.bands.ALLOW}/${n.bands.REVIEW}/${n.bands.BLOCK}, every document agrees`;
});

await gate("G13 cold check: repeat makes zero Surf calls", async () => {
  const { coldSignals } = await import("../src/cold.js");
  const { loadCensus } = await import("../src/census.js");
  const c = loadCensus();
  let fetches = 0;
  const now = Math.floor(Date.now() / 1000);
  const fetcher = {
    balance: () => 1000,
    fetch: async (payee: string) => {
      fetches++;
      return { row: { payee, first_inbound_at: now - 40 * 86400, inbound_count: 10, outbound_count: 1, distinct_inbound_senders: 8, top_payer_share: 0.2, inbound_usd: 5 } as never, calls: 2 };
    },
  };
  const p = "0x9999999999999999999999999999999999999999";
  const a = await coldSignals(p, "eip155:8453", c, fetcher);
  const b = await coldSignals(p, "eip155:8453", c, fetcher);
  assert(a.ok && a.surf_calls === 2, "first cold check did not fetch");
  assert(b.ok && b.source === "cache" && b.surf_calls === 0 && fetches === 1, "repeat made Surf calls");
  const low = await coldSignals("0x8888888888888888888888888888888888888888", "base", c, { ...fetcher, balance: () => 39 });
  assert(!low.ok && low.reason === "budget_guard", "floor not enforced before spending");
  return "first 2 calls, repeat 0 (cache), floor refuses before spending";
});

await gate("G14 kinship threshold v2", async () => {
  const { evaluateVows, KINSHIP_MIN, KINSHIP_REVIEW_AT } = await import("../src/core/vows.js");
  const fx = JSON.parse(readFileSync(join(ROOT, "fixtures", "payees.json"), "utf8"))[0];
  const band = (fanout: number) => evaluateVows({ signals: { ...fx, first_funder: "0xring", funder_fanout: fanout }, price: 0.05, funder_labels: {} }).find((r) => r.vow === "kinship")!;
  assert(KINSHIP_MIN === 3 && KINSHIP_REVIEW_AT === 21, `thresholds ${KINSHIP_MIN}/${KINSHIP_REVIEW_AT}`);
  assert(!band(2).fired && band(3).band === "BLOCK" && band(20).band === "BLOCK", "3..20 must BLOCK");
  assert(band(21).band === "REVIEW" && band(21).flags?.includes("kinship_suspected_exchange"), "21+ must be REVIEW with the flag");
  return "fanout 3..20 BLOCK, 21+ REVIEW (kinship_suspected_exchange)";
});

await gate("G15 sensitivity table matches numbers", async () => {
  const { sensitivity } = await import("./sensitivity.js");
  const { computeNumbers } = await import("./numbers.js");
  const s = sensitivity();
  const n = computeNumbers();
  const B = s.policies.B;
  assert(B.ALLOW === n.bands.ALLOW && B.REVIEW === n.bands.REVIEW && B.BLOCK === n.bands.BLOCK, `policy B ${JSON.stringify(B)} vs numbers ${JSON.stringify(n.bands)}`);
  const md = readFileSync(join(ROOT, "artifacts", "sensitivity.md"), "utf8");
  assert(md.includes(`| B | ${B.ALLOW} | ${B.REVIEW} | ${B.BLOCK} |`), "artifacts/sensitivity.md is stale: run npx tsx scripts/sensitivity.ts --write");
  assert(s.newBlocks === 0, `calibration created ${s.newBlocks} BLOCKs`);
  return `policy B ${B.ALLOW}/${B.REVIEW}/${B.BLOCK} = numbers.json, 0 new BLOCKs`;
});

const total = Math.round(performance.now() - t0);
const attempts = (globalThis as { __fiangshiNetAttempts?: number }).__fiangshiNetAttempts ?? 0;
const failed = rows.filter((r) => !r.ok).length;
console.log(`\nnetwork attempts (in-process): ${attempts}`);
console.log(`total ${total}ms (${total < 20_000 ? "<20s ok" : "OVER 20s"}) — ${rows.length - failed}/${rows.length} PASS`);
console.log(`\n| gate | result | duration | notes |\n|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.gate} | ${r.ok ? "PASS" : "FAIL"} | ${r.ms}ms | ${r.notes.replace(/\|/g, "/")} |`);
process.exit(failed === 0 && attempts === 0 && total < 20_000 ? 0 : 1);
