/**
 * Payee audit over the x402 Bazaar catalog. Mechanical: enumerate -> dedupe -> sample -> probe -> batched Surf -> report.
 *
 *   npx tsx scripts/audit.ts sample [--n 200] [--out f]   0 credits. data/bazaar/resources.jsonl -> fixtures/audit/sample.json
 *   npx tsx scripts/audit.ts probe                         0 credits. 1 unpaid GET per sampled payee, 1 req/sec -> probes.jsonl
 *   npx tsx scripts/audit.ts reprobe-unparsed              0 credits. re-GET only the 402s the parser rejected, save raw shapes
 *   npx tsx scripts/audit.ts gate                          5 credits. modified inbound query on 5 known payees; asserts top_payer_share usable
 *   npx tsx scripts/audit.ts run [--sample f] [--batch N] [--gate-ms 24000]   (runs the gate first unless it passed today)
 *        Staged + checkpointed (fixtures/audit/checkpoint-<sample>.json); re-running resumes.
 *        No SURF_API_KEY: sync calls; first batch is timed and later batches run only if every call took <= gate-ms.
 *                         Each call checks today's remaining free-tier credits first and checkpoints + stops if short.
 *        SURF_API_KEY set : async jobs (onchain-sql-job-create) per batch, same single-branch SQL.
 *   npx tsx scripts/audit.ts report [--sample f]           0 credits -> artifacts/audit.md
 *
 * Sample = Base (eip155:8453) payees, deduped, ordered by sha256(payee): reproducible, not biased by catalog order.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse402 } from "../src/adapters/probe.js";
import { funderLabelsFromSurf, signalsFromSurf, type SurfPayeeRow, type SurfWalletLabel } from "../src/adapters/surf.js";
import { sha256 } from "../src/core/canonical.js";
import type { Band, PayeeSignals } from "../src/core/types.js";
import { loadDotEnv } from "../src/config.js";
import { diffE, policyBand } from "../src/policy.js";
import { computeFanout } from "../src/snapshot.js";
import { costLine, guarded } from "./budget.js";
import { writeNoClobber } from "../src/fsutil.js";
import { runAsync, runSync, type Call } from "./surf/payee-facts.js";

const ROOT = join(import.meta.dirname, "..");
const AUD = join(ROOT, "fixtures", "audit");
const SURF = process.env.SURF_BIN ?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".local", "bin", "surf.exe");
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const FREE_PER_DAY = 30;
const DAYS = 365;
const COST = { sql: 5, labels: 1 } as const; // measured 2026-11-08 (docs: 4 and 4)
const ADDR = /^0x[0-9a-f]{40}$/;

interface CatalogRow { resource: string | null; serviceName: string | null; network: string | null; payTo: string | null; amount: string | null; asset: string | null }
export interface SamplePayee { payee: string; resources: number; example_url: string; service: string | null; price_usd: number | null }
export interface Sample {
  method: string;
  catalog: { resources: number; base_resources: number; base_usdc_resources: number; distinct_base_payees: number; endpoints_per_payee: number; top_payees: { payee: string; resources: number }[] };
  payees: SamplePayee[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const readJsonl = <T>(p: string): T[] => readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as T);
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;

// ---------- sample (0 credits)
export function buildSample(rows: CatalogRow[], n: number): Sample {
  const base = rows.filter((r) => r.network === "eip155:8453" && r.payTo && ADDR.test(r.payTo));
  const byPayee = new Map<string, CatalogRow[]>();
  for (const r of base) (byPayee.get(r.payTo!) ?? byPayee.set(r.payTo!, []).get(r.payTo!)!).push(r);
  const ordered = [...byPayee.keys()].sort((a, b) => sha256(a).localeCompare(sha256(b)));
  const payees = ordered.slice(0, n).map((p): SamplePayee => {
    const rs = byPayee.get(p)!;
    const ex = rs.find((r) => r.asset === USDC_BASE && r.resource?.startsWith("http")) ?? rs.find((r) => r.resource?.startsWith("http")) ?? rs[0]!;
    const price = ex.asset === USDC_BASE && ex.amount && /^\d+$/.test(ex.amount) ? Number(ex.amount) / 1e6 : null;
    return { payee: p, resources: rs.length, example_url: ex.resource ?? "", service: ex.serviceName, price_usd: price };
  });
  const top = [...byPayee.entries()].map(([payee, rs]) => ({ payee, resources: rs.length })).sort((a, b) => b.resources - a.resources).slice(0, 10);
  return {
    method: `Base (eip155:8453) payTo from the x402 Bazaar catalog, deduped, ordered by sha256(payee), first ${Math.min(n, byPayee.size)}`,
    catalog: {
      resources: rows.length,
      base_resources: base.length,
      base_usdc_resources: base.filter((r) => r.asset === USDC_BASE).length,
      distinct_base_payees: byPayee.size,
      endpoints_per_payee: Math.round((base.length / Math.max(1, byPayee.size)) * 100) / 100,
      top_payees: top,
    },
    payees,
  };
}

// ---------- probes (0 credits)
async function getRaw(url: string) {
  const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  const text = await res.text();
  let body: unknown = text.slice(0, 4000);
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { url, status: res.status, headers, body };
}

async function probeSample(sample: Sample): Promise<void> {
  const out = join(AUD, "probes.jsonl");
  writeFileSync(out, "");
  for (const p of sample.payees) {
    let line: Record<string, unknown> = { payee: p.payee, url: p.example_url };
    try {
      const raw = await getRaw(p.example_url);
      const parsed = parse402(raw);
      line = { ...line, status: raw.status, parsed: parsed.ok, live_payee: parsed.ok ? parsed.terms.payee : null, payee_matches_catalog: parsed.ok ? parsed.terms.payee === p.payee : null, price: parsed.ok ? parsed.terms.price : null, error: parsed.ok ? null : parsed.error };
    } catch (e) {
      line = { ...line, status: null, parsed: false, error: (e as Error).message.slice(0, 120) };
    }
    appendFileSync(out, JSON.stringify(line) + "\n");
    await sleep(1000);
  }
}

/** Describe a 402 the parser rejected: which keys/headers it has, without guessing what they mean. */
export function shapeOf(raw: { status: number; headers: Record<string, string>; body: unknown }): string {
  const hdrs = Object.keys(raw.headers).filter((k) => /payment|x402|www-auth|l402|price/i.test(k));
  const b = raw.body;
  let bodyDesc: string;
  if (b === null || b === undefined || b === "") bodyDesc = "empty body";
  else if (typeof b === "string") bodyDesc = `text body (${b.trim().slice(0, 40).replace(/\s+/g, " ")}…)`;
  else if (Array.isArray(b)) bodyDesc = `JSON array`;
  else {
    const o = b as Record<string, unknown>;
    const acc = Array.isArray(o.accepts) ? o.accepts[0] : undefined;
    bodyDesc = `JSON keys {${Object.keys(o).slice(0, 8).join(", ")}}` + (acc && typeof acc === "object" ? ` · accepts[0] keys {${Object.keys(acc as object).slice(0, 10).join(", ")}}` : "");
  }
  return `${bodyDesc}; payment headers [${hdrs.join(", ") || "none"}]`;
}

async function reprobeUnparsed(): Promise<void> {
  const probes = readJsonl<Record<string, unknown>>(join(AUD, "probes.jsonl")).filter((p) => p.status === 402 && p.parsed === false);
  const dir = join(AUD, "unparsed");
  mkdirSync(dir, { recursive: true });
  for (const p of probes) {
    try {
      const raw = await getRaw(String(p.url));
      writeFileSync(join(dir, `${new URL(String(p.url)).host}.json`), JSON.stringify(raw, null, 2) + "\n");
      console.log(`${raw.status} ${p.url} :: ${shapeOf(raw)}`);
    } catch (e) {
      console.log(`ERR ${p.url} ${(e as Error).message}`);
    }
    await sleep(1000);
  }
}

// ---------- run (credits)
interface Checkpoint {
  sample: string;
  mode: "sync" | "async";
  batch: number;
  payee_rows: Record<string, SurfPayeeRow>;
  batches_done: number[];
  /** legacy (phase 3g) batch-index keys; superseded by per-payee done lists below. */
  parts_done?: string[];
  /** Payees whose inbound / outbound query has returned and been persisted (stage sizes may differ between runs). */
  inbound_done?: string[];
  outbound_done?: string[];
  chunk_costs?: { at: string; payees: number; credits: number | null }[];
  funders_done: boolean;
  funder_rows: SurfPayeeRow[];
  labels_done: string[];
  labels: SurfWalletLabel[];
  calls: { label: string; ms: number; credits: number | null; at: string }[];
  stopped: string | null;
}

export function creditsUsedTodayUtc(costsMd = join(ROOT, "artifacts", "costs.md"), today = new Date().toISOString().slice(0, 10)): number {
  if (!existsSync(costsMd)) return 0;
  return readFileSync(costsMd, "utf8")
    .split("\n")
    .filter((l) => l.startsWith(`| ${today}`) && l.includes("| surf |"))
    .reduce((a, l) => a + (Number(l.split("|")[5]?.trim()) || 0), 0);
}

function labelsCall(addrs: string[]): Promise<{ data: SurfWalletLabel[]; credits: number | null; ms: number }> {
  const t = Date.now();
  return guarded("surf", `wallet-labels-batch n=${addrs.length}`, async () => {
    const r = spawnSync(SURF, ["wallet-labels-batch", "--addresses", addrs.join(","), "--json"], { encoding: "utf8", timeout: 60_000 });
    const j = JSON.parse(r.stdout || "{}") as { error?: { code: string; message: string }; meta?: { credits_used?: number }; data?: SurfWalletLabel[] };
    if (j.error) throw new Error(`${j.error.code}: ${j.error.message}`);
    return { value: { data: j.data ?? [], credits: j.meta?.credits_used ?? null, ms: Date.now() - t }, units: j.meta?.credits_used ?? null };
  });
}

class StopRun extends Error {}

/** Surf refusals that must stop an unattended run (checkpoint + exit), never be retried in a loop. */
export const STOP_CODES = ["SQL_QUERY_IN_FLIGHT", "QUERY_TIMEOUT", "SQL_SYNC_COOLDOWN", "SYNC_QUERY_REQUIRES_ASYNC", "SYNC_PREFLIGHT_UNAVAILABLE", "ADMISSION_UNAVAILABLE", "RATE_LIMITED", "UNAUTHORIZED"];
export const isStopError = (msg: string) => STOP_CODES.some((c) => msg.includes(c)) || /\b429\b/.test(msg);

// ---------- paid gate (5 credits): prove the modified inbound query returns usable top_payer_share
/** Active, real payees from fixtures/402/real with known traffic (fixtures/surf/smoke-12payees.json). */
export const GATE_PAYEES = [
  "0x4aabe17c239ef71c3a26ba7c2b3e0aebbfc1df26",
  "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea",
  "0x3291e96b3bff7ed56e3ca8364273c5b4654b2b37",
  "0x589a2314a2e05f45e40c4823da3ba58d421db3d8",
  "0x17cd53c04d707ef0dd615ef56c633f02915a7905",
];

export interface GateResult { ok: boolean; reasons: string[]; values: Record<string, unknown> }

/** Pure check: every gate payee has top_payer_share as a finite float in [0,1], and not all five are exactly 1.0. */
export function checkGate(rows: Record<string, unknown>[], payees = GATE_PAYEES): GateResult {
  const reasons: string[] = [];
  const values: Record<string, unknown> = {};
  for (const p of payees) {
    const r = rows.find((x) => String(x.payee).toLowerCase() === p);
    const v = r?.top_payer_share;
    values[p] = v === undefined ? "missing row" : v;
    if (!r) reasons.push(`${p}: no row returned`);
    else if (typeof v !== "number" || !Number.isFinite(v)) reasons.push(`${p}: top_payer_share is ${v === null ? "null" : typeof v}`);
    else if (v < 0 || v > 1) reasons.push(`${p}: top_payer_share ${v} outside [0,1]`);
  }
  const nums = Object.values(values).filter((v): v is number => typeof v === "number");
  if (nums.length === payees.length && nums.every((v) => v === 1)) reasons.push("top_payer_share is exactly 1.0 for all five payees (query not discriminating)");
  return { ok: reasons.length === 0, reasons, values };
}

async function runGate(): Promise<boolean> {
  const keyed = Boolean(process.env.SURF_API_KEY);
  const at = new Date().toISOString();
  let rows: Record<string, unknown>[] = [];
  let calls: Call[] = [];
  let error: string | null = null;
  try {
    if (!keyed && FREE_PER_DAY - creditsUsedTodayUtc() < COST.sql) throw new Error(`free tier: fewer than ${COST.sql} credits left today (UTC)`);
    const r = keyed ? await runAsync(GATE_PAYEES, DAYS, "payee-inbound") : await runSync(GATE_PAYEES, DAYS, ["payee-inbound"]);
    rows = r.rows;
    calls = r.calls;
  } catch (e) {
    error = (e as Error).message;
  }
  const g = error ? { ok: false, reasons: [`call failed: ${error}`], values: {} } : checkGate(rows);
  const gatePath = writeNoClobber(join(AUD, `gate-${at.slice(0, 10)}.json`), JSON.stringify({ at, mode: keyed ? "async" : "sync", ok: g.ok, reasons: g.reasons, values: g.values, calls: calls.map((c) => ({ label: c.label, ms: c.ms, credits: c.credits })), rows }, null, 1) + "\n");
  console.log(`gate raw -> ${basename(gatePath)}`);
  for (const c of calls) console.log(`  gate ${c.label} credits=${c.credits} ${c.ms}ms`);
  console.log(`gate ${g.ok ? "PASS" : "FAIL"}: ${JSON.stringify(g.values)}`);
  if (!g.ok) {
    writeFileSync(
      join(ROOT, "artifacts", "audit-failure.md"),
      [
        `# Audit stopped at the paid gate`,
        ``,
        `Run at ${at}. The modified inbound query (\`scripts/surf/payee-inbound.sql\`) was run on the ${GATE_PAYEES.length} gate payees before any audit batch. It did not return usable \`top_payer_share\` values, so the audit was **not** started and nothing was retried.`,
        ``,
        `## Reasons`,
        ...g.reasons.map((r) => `- ${r}`),
        ``,
        `## Values`,
        `| payee | top_payer_share |`,
        `|---|---|`,
        ...GATE_PAYEES.map((p) => `| ${p} | ${JSON.stringify(g.values[p] ?? null)} |`),
        ``,
        `Calls: ${calls.map((c) => `${c.label} (${c.credits ?? "?"} credits, ${c.ms} ms)`).join("; ") || "none"}. Raw: \`fixtures/audit/gate-${at.slice(0, 10)}.json\`.`,
        ``,
        `Next step (manual): fix the query or the parser, re-run \`npx tsx scripts/audit.ts gate\` by hand, then the audit.`,
      ].join("\n") + "\n",
    );
    console.log("wrote artifacts/audit-failure.md — audit NOT started");
  }
  return g.ok;
}

/** Live Surf balance (free endpoint, needs a key). null when unavailable. */
export function surfBalance(): number | null {
  const r = spawnSync(SURF, ["me-credits", "--json"], { encoding: "utf8", timeout: 30_000 });
  try {
    const j = JSON.parse(r.stdout || "{}") as { data?: { credit_balance?: number } };
    return typeof j.data?.credit_balance === "number" ? j.data.credit_balance : null;
  } catch {
    return null;
  }
}

/** Stage verification: rows must be a subset of the submitted addresses with a sane top_payer_share. Pure. */
export function verifyStageRows(addrs: string[], rows: Record<string, unknown>[], template: string): string[] {
  const problems: string[] = [];
  const want = new Set(addrs);
  if (rows.length > addrs.length) problems.push(`${rows.length} rows for ${addrs.length} addresses`);
  for (const r of rows) {
    const p = String(r.payee ?? "");
    if (!want.has(p)) problems.push(`row for unrequested address ${p.slice(0, 12)}`);
    if (template === "payee-inbound") {
      const v = r.top_payer_share;
      if (v !== null && v !== undefined && (typeof v !== "number" || v < 0 || v > 1)) problems.push(`${p.slice(0, 12)} top_payer_share=${JSON.stringify(v)}`);
    }
  }
  return problems;
}

export interface RunOpts {
  batch: number;
  gateMs: number;
  /** Process at most this many still-pending payees in this invocation (stages: 50, 300, rest). */
  limit?: number;
  /** Stop before any paid call when the live balance is below this (keyed runs). */
  minCredits?: number;
  /** Stop on any discrepancy: poll/result credits > 0, schema problems in returned rows. */
  verify?: boolean;
  /** Only payee queries this invocation (funders + labels wait until every payee is done). */
  payeesOnly?: boolean;
  /** "sync" forces synchronous calls even with a key (async has an undocumented scan ceiling, 2026-11-09). */
  mode?: "sync" | "async";
  /** Keyed runs: stop if one chunk's measured cost (balance delta) exceeds this. */
  maxChunkCredits?: number;
  /** Run funders + labels for the payees audited so far, even if the sample is not complete (partial census). */
  finish?: boolean;
  /** Funder-outbound chunk size (default max(batch, 300)). */
  funderChunk?: number;
}

async function runAudit(sample: Sample, samplePath: string, opts: RunOpts): Promise<Checkpoint> {
  const { batch: batchSize, gateMs } = opts;
  const keyed = Boolean(process.env.SURF_API_KEY);
  const asyncMode = keyed && opts.mode !== "sync";
  const cpPath = join(AUD, `checkpoint-${basename(samplePath, ".json")}.json`);
  const costsPath = join(ROOT, "artifacts", "costs.md");
  const cp: Checkpoint = existsSync(cpPath)
    ? (JSON.parse(readFileSync(cpPath, "utf8")) as Checkpoint)
    : { sample: basename(samplePath), mode: keyed ? "async" : "sync", batch: batchSize, payee_rows: {}, batches_done: [], funders_done: false, funder_rows: [], labels_done: [], labels: [], calls: [], stopped: null };
  cp.stopped = null;
  cp.mode = asyncMode ? "async" : "sync";
  cp.inbound_done ??= [];
  cp.outbound_done ??= [];
  const save = () => writeFileSync(cpPath, JSON.stringify(cp, null, 1) + "\n");
  const need = (credits: number, what: string) => {
    if (keyed) {
      if (opts.minCredits === undefined) return;
      const bal = surfBalance();
      if (bal === null) throw new StopRun(`could not read Surf balance before ${what}; stopping (fail closed).`);
      if (bal - credits < opts.minCredits) throw new StopRun(`balance ${bal} − ${credits} for ${what} would fall below the ${opts.minCredits}-credit buffer. Checkpoint saved.`);
      return;
    }
    const left = FREE_PER_DAY - creditsUsedTodayUtc();
    if (left < credits) throw new StopRun(`free tier: ${left} credits left today (UTC), ${what} needs ${credits}. Checkpoint saved; re-run after 00:00 UTC to resume.`);
  };
  const log = (calls: Call[]) => {
    for (const c of calls) {
      cp.calls.push({ label: c.label, ms: c.ms, credits: c.credits, at: new Date().toISOString() });
      console.log(`  ${c.label.padEnd(52)} credits=${c.credits} ${c.ms}ms`);
      // submits are already logged by the budget guard; polls/results are logged here, immediately
      if (/job-(get|results)/.test(c.label)) costLine(costsPath, `| ${new Date().toISOString()} | surf | ${c.label} | poll (not budget-counted) | ${c.credits ?? "n/a"} | ok |`);
    }
  };

  /** One SQL call; Surf refusals become a clean StopRun (checkpoint kept, no retry). */
  const sqlCall = async (addrs: string[], t: "payee-inbound" | "payee-outbound") => {
    need(COST.sql, t);
    let r: Awaited<ReturnType<typeof runSync>>;
    try {
      r = asyncMode ? await runAsync(addrs, DAYS, t) : await runSync(addrs, DAYS, [t]);
    } catch (e) {
      const msg = (e as Error).message;
      if (isStopError(msg)) throw new StopRun(`Surf refused ${t} (${addrs.length} addresses): ${msg}. Checkpoint saved; not retried.`);
      throw e;
    }
    log(r.calls);
    const submit = r.calls[0];
    const job = (submit?.envelope.data ?? {}) as { job_id?: string; status?: string };
    const polls = r.calls.filter((c) => /job-(get|results)/.test(c.label));
    const pollCredits = polls.reduce((a, c) => a + (c.credits ?? 0), 0);
    const problems = verifyStageRows(addrs, r.rows, t);
    console.log(`  ${t}: ${addrs.length} addresses -> ${r.rows.length} rows${job.job_id ? `, job ${job.job_id}` : ""}, submit ${submit?.credits ?? "?"} credits, ${polls.length} polls/results ${pollCredits} credits, schema ${problems.length ? "PROBLEMS" : "ok"}`);
    if (asyncMode && r.rows.length === 0 && addrs.length > 0) problems.push("async job returned no rows (did not succeed?)");
    if (opts.verify && (pollCredits > 0 || problems.length)) throw new StopRun(`stage verification failed for ${t}: ${[pollCredits > 0 ? `polling cost ${pollCredits} credits` : "", ...problems].filter(Boolean).join("; ")}`);
    return r;
  };
  const gateCheck = (label: string, ms: number) => {
    if (!asyncMode && ms > gateMs) throw new StopRun(`${label} took ${ms}ms > ${gateMs}ms gate. Saved; re-run with a smaller --batch.`);
  };

  const payees = sample.payees.map((p) => p.payee);
  const pending = payees.filter((p) => !cp.outbound_done!.includes(p)).slice(0, opts.limit ?? Infinity);
  const chunks: string[][] = [];
  for (let i = 0; i < pending.length; i += batchSize) chunks.push(pending.slice(i, i + batchSize));

  try {
    for (const [ci, chunk] of chunks.entries()) {
      console.log(`chunk ${ci + 1}/${chunks.length}: ${chunk.length} payees (${payees.length - payees.filter((p) => !cp.outbound_done!.includes(p)).length}/${payees.length} done before)`);
      const balBefore = keyed && opts.maxChunkCredits !== undefined ? surfBalance() : null;
      for (const t of ["payee-inbound", "payee-outbound"] as const) {
        const doneList = t === "payee-inbound" ? cp.inbound_done! : cp.outbound_done!;
        const todo = chunk.filter((p) => !doneList.includes(p));
        if (!todo.length) continue;
        const r = await sqlCall(todo, t);
        // persist this part immediately — a later failure must never discard rows already paid for
        for (const p of todo) cp.payee_rows[p] = { ...(cp.payee_rows[p] ?? { payee: p }), ...((r.rows.find((x) => x.payee === p) ?? {}) as Partial<SurfPayeeRow>) } as SurfPayeeRow;
        doneList.push(...todo);
        save();
        gateCheck(`chunk ${ci + 1} ${t}`, Math.max(...r.calls.map((c) => c.ms)));
      }
      if (balBefore !== null) {
        const balAfter = surfBalance();
        const spent = balAfter === null ? null : balBefore - balAfter;
        cp.chunk_costs = [...(cp.chunk_costs ?? []), { at: new Date().toISOString(), payees: chunk.length, credits: spent }];
        save();
        console.log(`  chunk ${ci + 1} cost ${spent ?? "?"} credits (balance ${balAfter ?? "?"}; limit ${opts.maxChunkCredits})`);
        if (spent === null) throw new StopRun(`could not read balance after chunk ${ci + 1}; stopping (fail closed).`);
        if (spent > opts.maxChunkCredits!) throw new StopRun(`chunk ${ci + 1} cost ${spent} credits > ${opts.maxChunkCredits} (estimate +20%). Stopped.`);
      }
    }
    const audited = payees.filter((p) => cp.outbound_done!.includes(p));
    const allDone = audited.length === payees.length;
    if (opts.payeesOnly || (!allDone && !opts.finish)) {
      console.log(`payee queries: ${audited.length}/${payees.length} done${allDone ? "" : "; funders + labels wait (pass --finish for a partial census)"}`);
      save();
      return cp;
    }
    const funders = [...new Set(audited.map((p) => String(cp.payee_rows[p]?.first_inbound_from ?? "")).filter((a) => ADDR.test(a)))];
    if (!cp.funders_done && funders.length) {
      console.log(`funders: ${funders.length}`);
      const rows: SurfPayeeRow[] = [];
      // Funder outbound is one light aggregate: chunk at 300 so a 200-payee free-tier run needs ONE call (29 credits total, fits 30/day).
      const fChunk = opts.funderChunk ?? Math.max(batchSize, 300);
      for (let i = 0; i < funders.length; i += fChunk) rows.push(...((await sqlCall(funders.slice(i, i + fChunk), "payee-outbound")).rows as unknown as SurfPayeeRow[]));
      cp.funder_rows = rows;
      cp.funders_done = true;
      save();
    }
    const addrs = [...new Set([...audited, ...funders])].filter((a) => !cp.labels_done.includes(a));
    for (let i = 0; i < addrs.length; i += 100) {
      const chunk = addrs.slice(i, i + 100);
      need(COST.labels, "wallet-labels-batch");
      const r = await labelsCall(chunk);
      cp.labels.push(...r.data);
      cp.labels_done.push(...chunk);
      cp.calls.push({ label: `wallet-labels-batch n=${chunk.length}`, ms: r.ms, credits: r.credits, at: new Date().toISOString() });
      console.log(`  wallet-labels-batch n=${chunk.length}`.padEnd(54) + ` credits=${r.credits} ${r.ms}ms`);
      save();
    }
  } catch (e) {
    cp.stopped = (e as Error).message;
    save();
    if (!(e instanceof StopRun)) throw e;
    console.log(`STOPPED: ${cp.stopped}`);
    return cp;
  }
  console.log(`complete: ${Object.keys(cp.payee_rows).length} payees, credits ${cp.calls.reduce((a, c) => a + (c.credits ?? 0), 0)}`);
  return cp;
}

// ---------- report (0 credits)
const AGE_BUCKETS: [string, number][] = [["< 48h", 48], ["48h – 7d", 168], ["7 – 30d", 720], ["30 – 90d", 2160], ["90 – 365d", 8760]];

export interface ReportInputs {
  sample: Sample;
  cp: Pick<Checkpoint, "payee_rows" | "funder_rows" | "labels" | "labels_done" | "calls" | "stopped" | "mode">;
  ranAt: string;
  probes?: Record<string, unknown>[];
  unparsed?: { url: string; shape: string; parsesNow?: boolean }[];
  knownPair?: { payees: { payee: string; host: string }[]; funder: string } | null;
}

export function auditReport(inp: ReportInputs): string {
  const { sample, cp } = inp;
  const probes = inp.probes ?? [];
  const now = Math.floor(Date.parse(inp.ranAt) / 1000);
  const windowStart = now - DAYS * 86_400;
  const outByFunder = Object.fromEntries(cp.funder_rows.map((r) => [r.payee.toLowerCase(), r.distinct_outbound_receivers ?? 0]));
  const { labels: funderLabels, tokenContracts } = funderLabelsFromSurf(cp.labels, outByFunder);
  const labelOf = new Map(cp.labels.map((l) => [l.address.toLowerCase(), l]));
  const priceOf = new Map(sample.payees.map((p) => [p.payee, p.price_usd]));
  const audited = sample.payees.filter((p) => cp.payee_rows[p.payee]);

  let signals: PayeeSignals[] = audited.map((p) => {
    const l = labelOf.get(p.payee);
    return signalsFromSurf(cp.payee_rows[p.payee]!, { now, windowStart, tokenContracts, identity: l?.entity_name ? { claims_org: l.entity_name, corroborated: true } : undefined });
  });
  const fan = computeFanout(signals, { labels: funderLabels, edges: {} });
  signals = signals.map((s) => (s.first_funder ? { ...s, funder_fanout: fan.get(s.payee) ?? 0 } : s));
  const items = signals.map((s) => ({ s, price: priceOf.get(s.payee) ?? null }));
  const v2 = items.map((x) => ({ ...x, r: policyBand(x.s, x.price, funderLabels, "v2") }));
  const diff = diffE(items, funderLabels);

  const n = signals.length;
  const total = sample.catalog.distinct_base_payees;
  const pct = (x: number, d = n) => `${((100 * x) / Math.max(1, d)).toFixed(1)}%`;
  const active = signals.filter((s) => s.wallet_age_hours !== null);
  const floored = active.filter((s) => s.wallet_age_hours! >= (now - windowStart) / 3600 - 24);
  const buckets = AGE_BUCKETS.map(([name, max], i) => {
    const min = i === 0 ? 0 : AGE_BUCKETS[i - 1]![1];
    return [name, active.filter((s) => s.wallet_age_hours! >= min && s.wallet_age_hours! < max && !floored.includes(s)).length] as const;
  });
  const young = buckets[0]![1];

  const clusters = new Map<string, string[]>();
  for (const s of signals) if (s.first_funder && funderLabels[s.first_funder] !== "cex") (clusters.get(s.first_funder) ?? clusters.set(s.first_funder, []).get(s.first_funder)!).push(s.payee);
  const multi = [...clusters.entries()].filter(([, ps]) => ps.length >= 2).sort((a, b) => b[1].length - a[1].length);
  const cexFunded = signals.filter((s) => s.first_funder && funderLabels[s.first_funder] === "cex");
  const viaLabel = cexFunded.filter((s) => labelOf.get(s.first_funder!)?.entity_type?.toLowerCase() === "cex").length;
  const labelledCount = cp.labels.length;
  const labelQueried = cp.labels_done.length;

  const bands = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<Band, number>;
  v2.forEach((e) => bands[e.r.band]++);
  const vowCount = new Map<string, number>();
  v2.forEach((e) => e.r.fired.forEach((v) => vowCount.set(v, (vowCount.get(v) ?? 0) + 1)));
  const tokenOne = signals.filter((s) => s.token_asset_share !== null && s.token_asset_share >= 0.99).length;

  const sqlCalls = cp.calls.filter((c) => c.label.startsWith("onchain-sql") && !/job-(get|results)/.test(c.label));
  const labelCalls = cp.calls.filter((c) => c.label.startsWith("wallet-labels"));
  const credits = cp.calls.reduce((a, c) => a + (c.credits ?? 0), 0);
  const sqlCredits = [...new Set(sqlCalls.map((c) => c.credits))];
  const slowest = sqlCalls.length ? Math.max(...sqlCalls.map((c) => c.ms)) : 0;

  const p402 = probes.filter((p) => p.status === 402).length;
  const pParsed = probes.filter((p) => p.parsed === true).length;
  const rotated = probes.filter((p) => p.payee_matches_catalog === false);
  const dist: Record<string, number> = {};
  probes.forEach((p) => (dist[String(p.status ?? "error")] = (dist[String(p.status ?? "error")] ?? 0) + 1));
  const top = sample.catalog.top_payees[0];

  const L: string[] = [];
  L.push(`# Payee audit — x402 Bazaar catalog, Base`, ``);
  L.push(`Generated by \`npx tsx scripts/audit.ts report\` from \`fixtures/audit/\` (sample, checkpoint, probes). Surf data through ${inp.ranAt}; ${DAYS}-day window.${cp.stopped ? ` **Run incomplete:** ${cp.stopped}` : ""}`, ``);

  L.push(`## Method`, ``);
  L.push(`1. Enumerated the public Bazaar catalog (\`scripts/enumerate-bazaar.ts\`, 0 credits): every resource with its \`accepts[0].payTo\`, network and price.`);
  L.push(`2. Deduped Base (\`eip155:8453\`) payees. ${sample.method}.`);
  L.push(`3. Probed one live endpoint per sampled payee, unpaid (1 req/sec, 0 credits), to check the catalog payee against the live 402.`);
  L.push(`4. Ran batched Surf SQL over \`agent.base_transfers\`: payee inbound + payee outbound + funder outbound. Each query covers the whole batch, never one payee at a time. Then \`wallet-labels-batch\` in groups of ≤100 addresses.`);
  L.push(`5. Scored with the deterministic policy (score + vows, no model) under **E v2** (payer concentration).`, ``);

  L.push(`## Census`, ``);
  L.push(`| metric | value |`, `|---|---|`);
  L.push(`| catalog resources | ${sample.catalog.resources.toLocaleString("en-US")} |`);
  L.push(`| Base resources | ${sample.catalog.base_resources.toLocaleString("en-US")} (${pct(sample.catalog.base_resources, sample.catalog.resources)}; ${sample.catalog.base_usdc_resources.toLocaleString("en-US")} priced in USDC) |`);
  L.push(`| distinct Base payees | ${total.toLocaleString("en-US")} |`);
  L.push(`| **endpoints → payees** | **${sample.catalog.endpoints_per_payee} resources per payee** |`);
  if (top) L.push(`| largest payee | ${short(top.payee)}: ${top.resources.toLocaleString("en-US")} resources (${pct(top.resources, sample.catalog.base_resources)} of Base) |`);
  L.push(`| **coverage** | **${n} of ${total.toLocaleString("en-US")} payees audited (${pct(n, total)})** |`, ``);
  L.push(`*For a buyer:* the catalog looks like ${sample.catalog.base_resources.toLocaleString("en-US")} sellers but is ${total.toLocaleString("en-US")} wallets. Diversifying across endpoints is not diversifying across counterparties.`, ``);

  if (probes.length) {
    L.push(`## Live probes (${probes.length} unpaid GETs, one per sampled payee)`, ``);
    L.push(`| status | count | meaning |`, `|---|---|---|`);
    const meaning: Record<string, string> = { "402": "paywall answered", "405": "POST-only resource, probed with GET", "404": "dead listing", "200": "served without a paywall", "401": "auth-gated", "400": "bad request without parameters", "502": "upstream error", "503": "unavailable", error: "network error / timeout" };
    for (const [s, c] of Object.entries(dist).sort((a, b) => b[1] - a[1])) L.push(`| ${s} | ${c} | ${meaning[s] ?? ""} |`);
    L.push(``, `${p402} returned 402 · ${pParsed} parsed · **${rotated.length} payee mismatches** (live \`payTo\` ≠ catalog).`, ``);
    if (inp.unparsed?.length) {
      L.push(`**${inp.unparsed.length} unparseable 402 shapes** at probe time (raw saved in \`fixtures/audit/unparsed/\`; failed closed, not guessed):`, ``);
      for (const u of inp.unparsed) L.push(`- \`${u.url}\` — ${u.shape} — ${u.parsesNow ? "**parses after the multi-entry fix**" : "still rejected: no usable accepts[]"}`);
      const fixedNow = inp.unparsed.filter((u) => u.parsesNow).length;
      L.push(``, `Parser fix (validate each \`accepts[]\` entry on its own instead of the whole array): ${fixedNow} of ${inp.unparsed.length} now parse, so **${pParsed + fixedNow} of ${p402}** 402s are usable.`, ``);
    }
    L.push(`*For a buyer:* ${pct(probes.length - p402, probes.length)} of listed endpoints did not answer a plain GET with a 402. A catalog listing is not proof of a working paywall. Probe before you budget.`, ``);
  }

  L.push(`## Wallet age — LOWER BOUNDS (first transfer within the ${DAYS}-day window)`, ``);
  L.push(`| bucket (lower bound) | payees | share |`, `|---|---|---|`);
  for (const [b, c] of buckets) L.push(`| ${b} | ${c} | ${pct(c)} |`);
  L.push(`| ≥ ${DAYS}d (floored at window start) | ${floored.length} | ${pct(floored.length)} |`, `| no transfers in window | ${n - active.length} | ${pct(n - active.length)} |`, ``);
  L.push(`*For a buyer:* ${young} payees (${pct(young)}) first appeared under 48h ago. The age vow BLOCKs them regardless of model advice. Every other age here is a floor, never an overstatement.`, ``);

  L.push(`## Funder clusters (exchanges excluded)`, ``);
  L.push(`Exchange exclusion: ${cexFunded.length} payees are CEX-funded (${viaLabel} by Surf \`entity_type: cex\` label, ${cexFunded.length - viaLabel} by the fanout ≥ 500 heuristic). ${tokenContracts.length} token contracts showed up as "first funder" and are treated as missing.`, ``);
  if (inp.knownPair) L.push(`Known pair (12-endpoint probe, 2026-11-08): **${inp.knownPair.payees.map((p) => `${p.host} (${short(p.payee)})`).join(" and ")}** share first funder ${short(inp.knownPair.funder)}.`, ``);
  if (multi.length) {
    L.push(`Clusters in the audited set. These are 1-hop: payees sharing a direct, non-exchange first funder. The kinship vow fires at ≥ 3 *other* payees.`, ``);
    L.push(`| funder | payees | kinship fires |`, `|---|---|---|`);
    for (const [f, ps] of multi.slice(0, 20)) L.push(`| ${short(f)} | ${ps.length} | ${ps.length >= 4 ? "yes" : "no"} |`);
  } else L.push(`No shared non-exchange funders in the audited set.`);
  L.push(``, `*For a buyer:* payees that share a non-exchange funder are probably one operator. Count them as one counterparty when you cap exposure.`, ``);

  L.push(`## Labels`, ``);
  L.push(`Label coverage: **${labelledCount}/${labelQueried}** addresses returned a Surf label in this run (phase 3d baseline: **6/23**). Unlabelled funders fall back to the fanout heuristic.`, ``);
  L.push(`*For a buyer:* labels confirm exchanges where they exist, but most wallets are unlabelled. Missing identity is the norm, and it is scored as neutral, not as trust.`, ``);

  L.push(`## Billing (measured)`, ``);
  L.push(`| call | count | credits / call (measured) | documented |`, `|---|---|---|---|`);
  L.push(`| on-chain SQL (${cp.mode}) | ${sqlCalls.length} | ${sqlCredits.join(", ") || "-"} | 4 |`);
  L.push(`| wallet-labels-batch | ${labelCalls.length} | ${[...new Set(labelCalls.map((c) => c.credits))].join(", ") || "-"} | 4 |`);
  L.push(``, `Total **${credits} credits** for ${n} payees. Slowest SQL call ${slowest} ms (30 s synchronous limit). Phase 3d baseline: 5 credits per SQL call for both 2 and 12 payees, against 4 documented. Billing is per call, not per payee.`, ``);
  L.push(`*For a buyer:* checking a counterparty costs a fixed amount per batch, so audits get cheaper per payee as they grow.`, ``);

  L.push(`## Policy bands (E v2, deterministic score + vows, no model)`, ``);
  L.push(`| band | payees | share |`, `|---|---|---|`);
  for (const b of ["ALLOW", "REVIEW", "BLOCK"] as Band[]) L.push(`| ${b} | ${bands[b]} | ${pct(bands[b])} |`);
  L.push(``, `Vows fired: ${[...vowCount.entries()].map(([v, c]) => `${v} ${c}`).join(" · ") || "none"}.`, ``);
  L.push(`E v1 → v2: **${diff.changed.length} of ${n} payees changed band** (v1 ${JSON.stringify(diff.v1)} → v2 ${JSON.stringify(diff.v2)}). ${tokenOne} of ${active.length} active payees take ≥ 99% of inbound USD in one token, which is why v1's token-concentration E was retired.`, ``);
  L.push(`*For a buyer:* ALLOW means every deterministic check passed. REVIEW means a human or a tighter budget should decide. BLOCK always cites the vow or the sub-50 score that caused it.`, ``);

  L.push(`## Caveats`, ``);
  L.push(`- Ages are floors. ${floored.length} payees sit at the window start, so their true age is ≥ ${DAYS}d. The 48h age vow is unaffected.`);
  L.push(`- Clusters are 1-hop within the audited set. 2-hop kinship needs funder-of-funder data, which this audit did not query.`);
  L.push(`- Identity counts as corroborated only where Surf has an \`entity_name\` label. Dolphin claim extraction is not wired into this audit.`);
  L.push(`- E v2 excludes a labelled-exchange first funder from the payer count. Other exchange or relayer senders are not individually labelled at this scale.`);
  return L.join("\n") + "\n";
}

function knownPairFromSmoke(): ReportInputs["knownPair"] {
  const p = join(ROOT, "fixtures", "surf", "smoke-12payees.json");
  const real = join(ROOT, "fixtures", "402", "real");
  if (!existsSync(p) || !existsSync(real)) return null;
  const rows = (JSON.parse(readFileSync(p, "utf8")) as { rows: SurfPayeeRow[] }).rows;
  const hostOf = new Map<string, string>();
  for (const f of readdirSync(real)) {
    const r = parse402(JSON.parse(readFileSync(join(real, f), "utf8")));
    if (r.ok) hostOf.set(r.terms.payee, new URL(r.terms.url).host);
  }
  const byFunder = new Map<string, SurfPayeeRow[]>();
  for (const r of rows) if (r.first_inbound_from) (byFunder.get(r.first_inbound_from) ?? byFunder.set(r.first_inbound_from, []).get(r.first_inbound_from)!).push(r);
  const pair = [...byFunder.entries()].find(([, rs]) => rs.length >= 2 && rs.every((r) => hostOf.get(r.payee)?.endsWith("apitoll.cloud")));
  return pair ? { funder: pair[0], payees: pair[1].map((r) => ({ payee: r.payee, host: hostOf.get(r.payee) ?? "?" })) } : null;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (k: string) => {
    const i = rest.indexOf(k);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  mkdirSync(AUD, { recursive: true });
  const samplePath = flag("--sample") ?? flag("--out") ?? join(AUD, "sample.json");
  if (cmd === "sample") {
    const s = buildSample(readJsonl<CatalogRow>(join(ROOT, "data", "bazaar", "resources.jsonl")), Number(flag("--n") ?? 200));
    writeFileSync(samplePath, JSON.stringify(s, null, 1) + "\n");
    console.log(JSON.stringify({ ...s.catalog, top_payees: undefined }), `\nsample: ${s.payees.length} payees -> ${samplePath}`);
  } else if (cmd === "probe") {
    await probeSample(JSON.parse(readFileSync(samplePath, "utf8")) as Sample);
  } else if (cmd === "reprobe-unparsed") {
    await reprobeUnparsed();
  } else if (cmd === "gate") {
    process.exit((await runGate()) ? 0 : 2);
  } else if (cmd === "run") {
    const keyed = Boolean(process.env.SURF_API_KEY);
    // Paid gate first (5 credits), unless a gate already PASSED today (UTC) — a same-day resume must not pay twice.
    const today = join(AUD, `gate-${new Date().toISOString().slice(0, 10)}.json`);
    const passedToday = existsSync(today) && (JSON.parse(readFileSync(today, "utf8")) as { ok: boolean }).ok;
    if (!passedToday && !(await runGate())) process.exit(2);
    // 100 payees took 34.1 s on 2026-11-09 (over the 30 s sync limit) once top_payer_share was added: free default is 50.
    const lim = flag("--limit");
    const minC = flag("--min-credits");
    await runAudit(JSON.parse(readFileSync(samplePath, "utf8")) as Sample, samplePath, {
      batch: Number(flag("--batch") ?? (keyed ? 300 : 50)),
      gateMs: Number(flag("--gate-ms") ?? 24_000),
      limit: lim ? Number(lim) : undefined,
      minCredits: minC ? Number(minC) : undefined,
      verify: rest.includes("--verify"),
      payeesOnly: rest.includes("--payees-only"),
      mode: flag("--mode") === "sync" ? "sync" : flag("--mode") === "async" ? "async" : undefined,
      maxChunkCredits: flag("--max-chunk-credits") ? Number(flag("--max-chunk-credits")) : undefined,
      finish: rest.includes("--finish"),
      funderChunk: flag("--funder-chunk") ? Number(flag("--funder-chunk")) : undefined,
    });
  } else if (cmd === "report") {
    const sample = JSON.parse(readFileSync(samplePath, "utf8")) as Sample;
    const cpPath = join(AUD, `checkpoint-${basename(samplePath, ".json")}.json`);
    if (!existsSync(cpPath)) throw new Error(`no checkpoint at ${cpPath}; run first`);
    const cp = JSON.parse(readFileSync(cpPath, "utf8")) as Checkpoint;
    const pp = join(AUD, "probes.jsonl");
    const ud = join(AUD, "unparsed");
    const unparsed = existsSync(ud)
      ? readdirSync(ud).map((f) => {
          const raw = JSON.parse(readFileSync(join(ud, f), "utf8")) as { url: string; status: number; headers: Record<string, string>; body: unknown };
          return { url: raw.url, shape: `HTTP ${raw.status}; ${shapeOf(raw)}`, parsesNow: parse402(raw as Parameters<typeof parse402>[0]).ok };
        })
      : [];
    const ranAt = cp.calls.filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop() ?? new Date().toISOString();
    const md = auditReport({ sample, cp, ranAt, probes: existsSync(pp) ? readJsonl(pp) : [], unparsed, knownPair: knownPairFromSmoke() });
    const out = flag("--report") ?? join(ROOT, "artifacts", "audit.md");
    writeFileSync(out, md);
    console.log(`report -> ${out}`);
  } else {
    console.error("usage: audit.ts sample [--n N --out f] | probe | reprobe-unparsed | gate | run [--sample f --batch N --gate-ms ms] | report [--sample f]");
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv();
  main().catch((e: Error) => {
    console.error(`audit failed: ${e.message}`);
    process.exit(1);
  });
}
