/**
 * ALLOW-only refresh (2026-11-24). The 72 h stale cap only ever changes ALLOW (to REVIEW); REVIEW and BLOCK serve the
 * same band fresh or stale. So between full refreshes, re-collecting just the payees the census issues ALLOW keeps every
 * ALLOW live, at about 2 SQL calls per 50 payees (~35 credits for ~160) instead of ~480 for all 1,922.
 *
 *   npx tsx scripts/refresh-allow.ts [--budget 60] [--floor 100] [--dry-run] [--commit] [--push]
 *
 * - Targets: every payee the served census issues ALLOW (the zero address is never queried).
 * - Writes fixtures/audit/sample-allow-<stamp>.json (overlay_of = the full refresh it sits on) and collects its
 *   checkpoint with scripts/audit.ts: batches of 50, a timed-out batch split straight to groups of 12 (0 timeouts in 13
 *   such groups on 20 Nov), progress saved after every SQL part, so a re-run resumes.
 * - Hard budget: the run stops cleanly, checkpoint saved, before the balance would drop below max(floor, start - budget).
 * - Appends the run to fixtures/audit/refresh-runs.json (served by GET /v1/census/status).
 * - --commit runs the test suite first and commits only if it is green; --push pushes main (the site and API redeploy).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ROOT } from "../src/config.js";

const flag = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (n: string) => process.argv.includes(n);
const BUDGET = Number(flag("--budget") ?? 60);
const FLOOR = Number(flag("--floor") ?? 100);
const AUDIT = join(ROOT, "fixtures", "audit");
const RUNS = join(AUDIT, "refresh-runs.json");
const ZERO = "0x0000000000000000000000000000000000000000";

const { loadCensus, currentRefreshSample, applicableOverlays, CENSUS_DAYS } = await import("../src/census.js");
const { checkpointPath, surfBalance } = await import("./audit.js");

const refreshSample = currentRefreshSample(CENSUS_DAYS);
if (!refreshSample) throw new Error("no full refresh is being served; an ALLOW-only overlay needs one to sit on");
const started = new Date();
const c = loadCensus();
const targets = new Set(c.payees.filter((p) => p.issued_band === "ALLOW" && p.payee !== ZERO).map((p) => p.payee));
const base = JSON.parse(readFileSync(refreshSample, "utf8")) as { method: string; catalog: unknown; payees: { payee: string }[] };
const payees = base.payees.filter((p) => targets.has(p.payee));
const prior = applicableOverlays(refreshSample, Date.now());
const seedFrom = prior.length ? prior[prior.length - 1]!.checkpoint : checkpointPath(refreshSample, CENSUS_DAYS);
const estimate = Math.ceil(payees.length / 50) * 2 * 4 + 8; // 2 SQL calls per 50 payees at 4 credits each, plus labels

console.log(`ALLOW-only refresh: ${payees.length} payees issued ALLOW in the served census (${basename(refreshSample)}${prior.length ? ` + ${prior.length} overlay(s)` : ""}); estimate ~${estimate} credits; budget ${BUDGET}, floor ${FLOOR}`);
if (has("--dry-run")) process.exit(0);

const startBal = surfBalance();
if (startBal === null) throw new Error("could not read the Surf balance (surf me-credits); not starting a paid run blind");
const stopBelow = Math.max(FLOOR, startBal - BUDGET);
if (startBal - estimate < stopBelow) {
  console.log(`not started: balance ${startBal}, estimate ${estimate}, would cross the stop line ${stopBelow}`);
  process.exit(3);
}

const stamp = started.toISOString().replace(/[-:]/g, "").slice(0, 13); // e.g. 20261124T1130
const samplePath = join(AUDIT, `sample-allow-${stamp}.json`);
if (!existsSync(samplePath))
  writeFileSync(samplePath, JSON.stringify({ method: `ALLOW-only overlay of ${basename(refreshSample)}: the payees it issues ALLOW, re-collected so the 72 h cap never reaches them (scripts/refresh-allow.ts)`, overlay_of: basename(refreshSample), catalog: base.catalog, payees }, null, 1) + "\n");

const run = spawnSync(
  process.execPath,
  [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "scripts", "audit.ts"), "run", "--sample", samplePath, "--days", String(CENSUS_DAYS), "--mode", "sync", "--batch", "50", "--split-to", "12", "--bisect-min", "6", "--gate-ms", "40000", "--min-credits", String(stopBelow), "--max-chunk-credits", "20", "--label-chunk", "20", "--seed-from", seedFrom],
  { cwd: ROOT, stdio: "inherit", env: { ...process.env, FIANGSHI_OFFLINE: "0", FIANGSHI_SURF_CALL_TIMEOUT_MS: "40000", FIANGSHI_MAX_SURF_CALLS: process.env.FIANGSHI_MAX_SURF_CALLS ?? "1000" /* lifetime call counter, not per run; the credit budget bounds the spend */ } },
);
const endBal = surfBalance();
const cpPath = checkpointPath(samplePath, CENSUS_DAYS);
const cp = existsSync(cpPath) ? (JSON.parse(readFileSync(cpPath, "utf8")) as { payee_rows: Record<string, unknown>; excluded?: string[]; funders_done?: boolean; stopped?: string | null }) : null;
const refreshed = cp ? payees.filter((p) => cp.payee_rows[p.payee]).length : 0;
const record = {
  at: started.toISOString(),
  finished_at: new Date().toISOString(),
  kind: "allow-only",
  overlay: basename(samplePath),
  overlay_of: basename(refreshSample),
  payees_targeted: payees.length,
  payees_refreshed: refreshed,
  payees_failed: payees.length - refreshed,
  credits_spent: startBal !== null && endBal !== null ? startBal - endBal : null,
  balance_after: endBal,
  budget: BUDGET,
  complete: Boolean(cp && cp.funders_done && refreshed + (cp.excluded ?? []).length >= payees.length),
  stopped: cp?.stopped ?? (run.status === 0 ? null : `audit.ts exited ${run.status}`),
};
const runs = existsSync(RUNS) ? (JSON.parse(readFileSync(RUNS, "utf8")) as unknown[]) : [];
writeFileSync(RUNS, JSON.stringify([...runs, record], null, 1) + "\n");
console.log(JSON.stringify(record, null, 1));

if (has("--commit")) {
  if (!record.complete) throw new Error("run incomplete: not committing (re-run to resume from the checkpoint)");
  const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  const test = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["test"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (test.status !== 0) throw new Error("tests are red: not committing");
  git("add", samplePath, cpPath, RUNS, join(ROOT, "artifacts", "costs.md"));
  const gate = join(AUDIT, `gate-${started.toISOString().slice(0, 10)}.json`);
  if (existsSync(gate)) git("add", gate);
  git("commit", "-q", "-m", `data(census): ALLOW-only refresh ${stamp}, ${refreshed}/${payees.length} payees, ${record.credits_spent ?? "?"} credits`);
  console.log(`committed ${git("rev-parse", "--short", "HEAD")}`);
  if (has("--push")) {
    if (git("branch", "--show-current") !== "main") throw new Error("not on main: refusing to push a census refresh from another branch");
    git("push", "-q", "origin", "main");
    console.log("pushed main: the API and the site redeploy");
  }
}
