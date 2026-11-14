/**
 * Measures the test and gate counts and records them, so no page or document carries a hand-typed count.
 *   npx tsx scripts/quality.ts
 * Runs `npx vitest run` and `npm run accept`, parses the counts, and writes them to artifacts/quality.json (the source
 * data/numbers.json "quality" is built from) and into artifacts/demo-stats.json (tests_passed, accept,
 * quality_measured_at), leaving that file's latency and its measured_at untouched: latency is measured by
 * `npm run localhost-check -- --live`, which needs provider keys. Then regenerate data/numbers.json
 * (`npx tsx scripts/numbers.ts`). Gate G12 fails if any of these disagree. 0 credits, no network beyond the tests' own.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";

// FIANGSHI_QUALITY_PENDING: G12 skips only its quality comparison during this run, since these are the counts being measured
const run = (cmd: string) => spawnSync(cmd, { cwd: ROOT, shell: true, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", FIANGSHI_QUALITY_PENDING: "1" } });

const t = run("npx vitest run");
const tests = Number(/Tests\s+(\d+) passed/.exec(t.stdout)?.[1] ?? 0);
const failed = /Tests\s+.*?(\d+) failed/.exec(t.stdout)?.[1];
if (t.status !== 0 || !tests || failed) {
  console.error(`npm test is not green (exit ${t.status}, ${failed ?? 0} failed): nothing written`);
  process.exit(1);
}
const a = run("npm run accept");
const accept = /(\d+\/\d+) PASS/.exec(a.stdout)?.[1];
const [ok, all] = (accept ?? "0/-1").split("/").map(Number);
if (a.status !== 0 || !accept || ok !== all) {
  console.error(`npm run accept is not green (exit ${a.status}, ${accept ?? "?"}): nothing written`);
  process.exit(1);
}

const measured_at = new Date().toISOString();
const quality = { tests, accept_gates: accept, measured_at };
writeFileSync(join(ROOT, "artifacts", "quality.json"), JSON.stringify(quality, null, 2) + "\n");

const statsPath = join(ROOT, "artifacts", "demo-stats.json");
if (existsSync(statsPath)) {
  const s = JSON.parse(readFileSync(statsPath, "utf8"));
  writeFileSync(statsPath, JSON.stringify({ ...s, tests_passed: tests, accept, quality_measured_at: measured_at }, null, 2) + "\n");
}
console.log(`quality: ${tests} tests passed, accept ${accept}, measured ${measured_at}`);
console.log("wrote artifacts/quality.json and artifacts/demo-stats.json; now run: npx tsx scripts/numbers.ts");
