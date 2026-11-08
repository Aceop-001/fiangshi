/**
 * ONE async Surf onchain-sql job for a payee ARRAY. Budget-guarded (counts as 1 surf call).
 *
 * Usage: npx tsx scripts/surf/payee-facts.ts <payee>[,<payee>...] [--days 365] [--control-env FIANGSHI_CONTROL_PAYEE]
 *   --control-env NAME  adds the address in env var NAME; it is redacted to "<CONTROL>" everywhere it is printed or saved.
 * Writes fixtures/surf/smoke-<YYYY-MM-DD>.json (raw submit / polls / results, control redacted).
 * Polling and result download are free per Surf docs; their meta.credits_used is recorded to prove it.
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

export function buildSql(payees: string[], days = 365): string {
  const list = [...new Set(payees.map((p) => p.trim().toLowerCase()))];
  if (list.length === 0) throw new Error("no payees");
  for (const p of list) if (!ADDR.test(p)) throw new Error("invalid payee address (must be 0x + 40 hex)");
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("days out of range");
  const tpl = readFileSync(join(ROOT, "scripts", "surf", "smoke-payees.sql"), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .join("\n");
  return tpl.replaceAll("__PAYEES__", list.map((p) => `'${p}'`).join(",")).replaceAll("__DAYS__", String(days)).trim();
}

interface Envelope {
  data?: Record<string, unknown> | Record<string, unknown>[];
  meta?: { credits_used?: number };
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

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const days = Number(flag("--days") ?? 365);
  const controlEnv = flag("--control-env");
  const control = controlEnv ? (process.env[controlEnv] ?? "").trim().toLowerCase() : "";
  if (controlEnv && !ADDR.test(control)) throw new Error(`${controlEnv} is not set to a valid 0x address`);
  const payees = (argv[0] && !argv[0].startsWith("--") ? argv[0].split(",") : []).concat(control ? [control] : []);
  const redact = (s: string) => (control ? s.replaceAll(control, "<CONTROL>") : s);

  const sql = buildSql(payees, days);
  const t0 = Date.now();
  const submit = await guarded("surf", `onchain-sql-job-create payees=${payees.length}`, async () => {
    const e = surf(["onchain-sql-job-create"], JSON.stringify({ sql, max_rows: 1000 }));
    if (e.error) throw new Error(`${e.error.code}: ${redact(e.error.message)}`);
    return { value: e, units: e.meta?.credits_used ?? null };
  });
  const job = submit.data as { job_id: string; status: string };
  console.log(`submit: job=${job.job_id} status=${job.status} credits_used=${submit.meta?.credits_used}`);

  const polls: Envelope[] = [];
  let status = job.status;
  while (!["succeeded", "failed", "canceled"].includes(status) && Date.now() - t0 < 300_000) {
    await sleep(3000);
    const p = surf(["onchain-sql-job-get", job.job_id]);
    polls.push(p);
    status = (p.data as { status?: string } | undefined)?.status ?? `error:${p.error?.code}`;
    console.log(`poll ${polls.length}: status=${status} credits_used=${p.meta?.credits_used}`);
    if (p.error) break;
  }
  const results = status === "succeeded" ? surf(["onchain-sql-job-results", job.job_id]) : null;
  const ms = Date.now() - t0;
  if (results) console.log(`results: rows=${Array.isArray(results.data) ? results.data.length : 0} credits_used=${results.meta?.credits_used}`);

  const pollCredits = polls.reduce((a, p) => a + (p.meta?.credits_used ?? 0), 0) + (results?.meta?.credits_used ?? 0);
  const record = { payees: payees.length, days, ms, submit, polls, results, credits: { submit: submit.meta?.credits_used ?? null, polls_and_results: pollCredits } };
  mkdirSync(join(ROOT, "fixtures", "surf"), { recursive: true });
  const out = join(ROOT, "fixtures", "surf", `smoke-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, redact(JSON.stringify(record, null, 2)) + "\n");
  console.log(redact(JSON.stringify((results?.data as unknown[]) ?? [], null, 2)));
  console.log(`saved ${out} (${ms}ms, submit credits ${record.credits.submit}, poll+download credits ${pollCredits})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv(); // control payee may live in .env (gitignored)
  main().catch((e: Error) => {
    console.error(`payee-facts failed: ${e.message}`);
    process.exit(1);
  });
}
