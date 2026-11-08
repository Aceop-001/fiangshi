/**
 * Payee facts from Surf for a payee ARRAY. Every call is budget-guarded.
 *
 * Modes:
 *   sync  (default without SURF_API_KEY): 2 synchronous onchain-sql calls per batch — inbound + outbound.
 *         Works on the unauthenticated free tier. Each branch is single-table, no UNION/OR/lower().
 *   async (default with SURF_API_KEY):    1 onchain-sql-job-create with the UNION query, then free polls.
 *         Surf returns UNAUTHORIZED for jobs without a key.
 *
 * Usage: npx tsx scripts/surf/payee-facts.ts <payee>[,<payee>...] [--days 365] [--mode sync|async]
 *          [--control-env NAME] [--tag name]
 *   --control-env NAME adds the address in env var NAME; redacted to "<CONTROL>" in all output and files.
 * Writes fixtures/surf/smoke-<tag|date>.json (raw envelopes, control redacted).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadDotEnv } from "../../src/config.js";
import { guarded } from "../budget.js";

const ROOT = join(import.meta.dirname, "..", "..");
const SURF = process.env.SURF_BIN ?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".local", "bin", "surf.exe");
const ADDR = /^0x[0-9a-f]{40}$/;

export type Template = "smoke-payees" | "payee-inbound" | "payee-outbound";

export function normalizePayees(payees: string[]): string[] {
  const list = [...new Set(payees.map((p) => p.trim().toLowerCase()))];
  if (list.length === 0) throw new Error("no payees");
  for (const p of list) if (!ADDR.test(p)) throw new Error("invalid payee address (must be 0x + 40 hex)");
  return list;
}

export function buildSql(payees: string[], days = 365, template: Template = "smoke-payees"): string {
  const list = normalizePayees(payees);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("days out of range");
  const tpl = readFileSync(join(ROOT, "scripts", "surf", `${template}.sql`), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .join("\n");
  return tpl.replaceAll("__PAYEES__", list.map((p) => `'${p}'`).join(",")).replaceAll("__DAYS__", String(days)).trim();
}

interface Envelope {
  data?: Record<string, unknown> | Record<string, unknown>[];
  meta?: { credits_used?: number; [k: string]: unknown };
  error?: { code: string; message: string };
}

function surf(args: string[], stdin?: string): Envelope {
  const r = spawnSync(SURF, [...args, "--json"], { input: stdin, encoding: "utf8", timeout: 60_000 });
  const out = (r.stdout || "").trim();
  try {
    return JSON.parse(out) as Envelope;
  } catch {
    return { error: { code: `exit_${r.status}`, message: (r.stderr || out).trim().split("\n").slice(0, 3).join(" | ") } };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Call {
  label: string;
  ms: number;
  credits: number | null;
  envelope: Envelope;
}

async function guardedSurf(label: string, args: string[], body?: object): Promise<Call> {
  const t = Date.now();
  const envelope = await guarded("surf", label, async () => {
    const e = surf(args, body ? JSON.stringify(body) : undefined);
    if (e.error) throw new Error(`${e.error.code}: ${e.error.message}`);
    return { value: e, units: e.meta?.credits_used ?? null };
  });
  return { label, ms: Date.now() - t, credits: envelope.meta?.credits_used ?? null, envelope };
}

export async function runSync(
  payees: string[],
  days: number,
  templates: readonly ("payee-inbound" | "payee-outbound")[] = ["payee-inbound", "payee-outbound"],
): Promise<{ calls: Call[]; rows: Record<string, unknown>[] }> {
  const calls: Call[] = [];
  for (const t of templates) {
    calls.push(await guardedSurf(`onchain-sql ${t} payees=${payees.length}`, ["onchain-sql"], { sql: buildSql(payees, days, t), max_rows: 1000 }));
  }
  const byPayee = new Map<string, Record<string, unknown>>(payees.map((p) => [p, { payee: p }]));
  for (const c of calls) for (const row of (c.envelope.data as Record<string, unknown>[]) ?? []) Object.assign(byPayee.get(String(row.payee)) ?? {}, row);
  return { calls, rows: [...byPayee.values()] };
}

/** One async job (requires SURF_API_KEY). Submit is billed + budget-guarded; polls/results are recorded but not counted. */
export async function runAsync(payees: string[], days: number, template: Template = "smoke-payees"): Promise<{ calls: Call[]; rows: Record<string, unknown>[] }> {
  const submit = await guardedSurf(`onchain-sql-job-create ${template} payees=${payees.length}`, ["onchain-sql-job-create"], { sql: buildSql(payees, days, template), max_rows: 10000 });
  const calls: Call[] = [submit];
  const job = submit.envelope.data as { job_id: string; status: string };
  let status = job.status;
  const t0 = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(status) && Date.now() - t0 < 300_000) {
    await sleep(3000);
    const t = Date.now();
    const e = surf(["onchain-sql-job-get", job.job_id]); // free per docs; not budget-counted, credits recorded
    calls.push({ label: "onchain-sql-job-get", ms: Date.now() - t, credits: e.meta?.credits_used ?? null, envelope: e });
    status = (e.data as { status?: string } | undefined)?.status ?? `error:${e.error?.code}`;
    if (e.error) break;
  }
  if (status !== "succeeded") return { calls, rows: [] };
  const t = Date.now();
  const res = surf(["onchain-sql-job-results", job.job_id]);
  calls.push({ label: "onchain-sql-job-results", ms: Date.now() - t, credits: res.meta?.credits_used ?? null, envelope: res });
  return { calls, rows: (res.data as Record<string, unknown>[]) ?? [] };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const days = Number(flag("--days") ?? 365);
  const mode = flag("--mode") ?? (process.env.SURF_API_KEY ? "async" : "sync");
  const tag = flag("--tag") ?? new Date().toISOString().slice(0, 10);
  const controlEnv = flag("--control-env");
  const control = controlEnv ? (process.env[controlEnv] ?? "").trim().toLowerCase() : "";
  if (controlEnv && !ADDR.test(control)) throw new Error(`${controlEnv} is not set to a valid 0x address`);
  const payees = normalizePayees((argv[0] && !argv[0].startsWith("--") ? argv[0].split(",") : []).concat(control ? [control] : []));
  const redact = (s: string) => (control ? s.replaceAll(control, "<CONTROL>") : s);

  const t0 = Date.now();
  const only = flag("--only"); // inbound | outbound (sync only)
  const templates = only === "inbound" ? (["payee-inbound"] as const) : only === "outbound" ? (["payee-outbound"] as const) : (["payee-inbound", "payee-outbound"] as const);
  const { calls, rows } = mode === "async" ? await runAsync(payees, days) : await runSync(payees, days, templates);
  const ms = Date.now() - t0;
  for (const c of calls) console.log(`${c.label.padEnd(44)} credits_used=${c.credits}  ${c.ms}ms`);
  const record = { mode, payees: payees.length, days, ms, credits_total: calls.reduce((a, c) => a + (c.credits ?? 0), 0), calls, rows };
  mkdirSync(join(ROOT, "fixtures", "surf"), { recursive: true });
  const out = join(ROOT, "fixtures", "surf", `smoke-${tag}.json`);
  writeFileSync(out, redact(JSON.stringify(record, null, 2)) + "\n");
  console.log(redact(JSON.stringify(rows, null, 1)));
  console.log(`saved ${out} — mode=${mode} payees=${payees.length} credits_total=${record.credits_total} ${ms}ms`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv(); // control payee / SURF_API_KEY may live in .env (gitignored)
  main().catch((e: Error) => {
    console.error(`payee-facts failed: ${e.message}`);
    process.exit(1);
  });
}
