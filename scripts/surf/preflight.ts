/**
 * ONE budget-guarded onchain-sql-preflight (EXPLAIN ESTIMATE; does not execute) for a payee template + chunk size.
 * Usage: npx tsx scripts/surf/preflight.ts <sample.json> <n> [payee-inbound|payee-outbound] [--days 365]
 * Prints estimated rows/bytes, server scan budgets and guardrail warnings; raw saved (no-clobber) to fixtures/surf/.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDotEnv } from "../../src/config.js";
import { writeNoClobber } from "../../src/fsutil.js";
import { guarded } from "../budget.js";
import { buildSql, type Template } from "./payee-facts.js";

loadDotEnv();
const ROOT = join(import.meta.dirname, "..", "..");
const SURF = process.env.SURF_BIN ?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".local", "bin", "surf.exe");
const [samplePath, nArg, tArg] = process.argv.slice(2);
const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 365;
const template = (tArg && !tArg.startsWith("--") ? tArg : "payee-inbound") as Template;
const payees = (JSON.parse(readFileSync(samplePath!, "utf8")) as { payees: { payee: string }[] }).payees.slice(0, Number(nArg)).map((p) => p.payee);
const sql = buildSql(payees, days, template);

const t = Date.now();
const e = await guarded("surf", `onchain-sql-preflight ${template} payees=${payees.length} days=${days}`, async () => {
  const r = spawnSync(SURF, ["onchain-sql-preflight", "--json"], { input: JSON.stringify({ sql, max_rows: 10000 }), encoding: "utf8", timeout: 60_000 });
  const j = JSON.parse(r.stdout || "{}") as { error?: { code: string; message: string }; meta?: { credits_used?: number }; data?: Record<string, unknown> };
  if (j.error) throw new Error(`${j.error.code}: ${j.error.message}`);
  return { value: j, units: j.meta?.credits_used ?? null };
});
const saved = writeNoClobber(join(ROOT, "fixtures", "surf", `preflight-${template}-${payees.length}.json`), JSON.stringify({ template, payees: payees.length, days, ms: Date.now() - t, envelope: e }, null, 2) + "\n");
const d = (e.data ?? {}) as Record<string, unknown>;
console.log(`credits_used=${e.meta?.credits_used} ms=${Date.now() - t} raw=${saved.split(/[\\/]/).pop()}`);
console.log(`top-level keys: ${Object.keys(d).join(", ")}`);
for (const [k, v] of Object.entries(d)) if (!/schema|sql$|columns/i.test(k)) console.log(`${k}: ${JSON.stringify(v).slice(0, 400)}`);
