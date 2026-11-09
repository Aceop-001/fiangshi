/**
 * Label the funders behind kinship BLOCKs that were never label-checked. Budget-guarded, balance floor enforced.
 * Usage: npx tsx scripts/label-cluster-funders.ts --sample fixtures/audit/sample-census.json --days 90 --floor 56 [--chunk 20]
 * Merges results into the checkpoint (labels + labels_done) so `audit.ts report` re-scores kinship with them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { checkpointPath, labelsCall, scoredSet, setWindowDays, surfBalance, type Sample } from "./audit.js";
import { loadDotEnv } from "../src/config.js";
import type { SurfWalletLabel } from "../src/adapters/surf.js";

loadDotEnv();
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const samplePath = arg("--sample")!;
const days = Number(arg("--days") ?? 90);
const floor = Number(arg("--floor"));
const chunkSize = Number(arg("--chunk") ?? 20);
if (!Number.isFinite(floor)) throw new Error("--floor required");
setWindowDays(days);

const cpPath = checkpointPath(samplePath, days);
const cp = JSON.parse(readFileSync(cpPath, "utf8"));
const sample = JSON.parse(readFileSync(samplePath, "utf8")) as Sample;
const ranAt = (cp.calls as { label: string; at: string }[]).filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop()!;
const { scored } = scoredSet(sample, cp, ranAt);
const queried = new Set<string>(cp.labels_done);
const funders = [...new Set(scored.filter((e) => e.r.fired.includes("kinship") && e.s.first_funder && !queried.has(e.s.first_funder)).map((e) => e.s.first_funder!))];
console.log(`kinship funders never label-checked: ${funders.length}`);

const got: SurfWalletLabel[] = [];
for (let i = 0; i < funders.length; i += chunkSize) {
  const chunk = funders.slice(i, i + chunkSize);
  const bal = surfBalance();
  if (bal === null || bal - 4 < floor) {
    console.log(`STOP: balance ${bal} − 4 would fall below the ${floor} floor`);
    break;
  }
  const r = await labelsCall(chunk);
  got.push(...r.data);
  cp.labels.push(...r.data);
  cp.labels_done.push(...chunk);
  cp.calls.push({ label: `wallet-labels-batch n=${chunk.length} (cluster funders)`, ms: r.ms, credits: r.credits, at: new Date().toISOString() });
  writeFileSync(cpPath, JSON.stringify(cp, null, 1) + "\n");
  console.log(`  labels n=${chunk.length}: ${r.data.length} returned (meta credits ${r.credits}) ${r.ms}ms`);
}
const types: Record<string, number> = {};
for (const l of got) types[l.entity_type ?? "(no type)"] = (types[l.entity_type ?? "(no type)"] ?? 0) + 1;
console.log(`returned ${got.length} labels for ${funders.length} funders: ${JSON.stringify(types)}`);
for (const l of got) console.log(`  ${l.address} | ${l.entity_name ?? "-"} | ${l.entity_type ?? "-"} | ${l.labels.map((x) => x.label).join("; ")}`);
console.log(`balance now ${surfBalance()}`);
