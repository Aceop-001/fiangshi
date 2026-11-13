/**
 * Win-rate instrumentation (0 credits): one table of how often Fiangshi is right, from committed data only.
 * Usage: npx tsx scripts/winrate.ts [--write]   (--write: artifacts/winrate.md)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { loadCensus } from "../src/census.js";
import { evaluateVows } from "../src/core/vows.js";
import { sensitivity } from "./sensitivity.js";

const LAB = join(ROOT, "fixtures", "lab");
const files = readdirSync(LAB).filter((f) => /^results(-attempt\d+)?\.json$/.test(f)).sort((a, b) => a.length - b.length || a.localeCompare(b));
const labFile = files[files.length - 1]!;
const lab = JSON.parse(readFileSync(join(LAB, labFile), "utf8")) as { ran_at: string; results: Record<string, any>[] };
const sup = JSON.parse(readFileSync(join(LAB, "supersessions.json"), "utf8")) as { cases: Record<string, { correct_under_v4: { band: string; vow: string | null } }> };

/** expectation under the current rules: the written one, or the documented supersession */
const expected = (r: Record<string, any>) => sup.cases[r.id]?.correct_under_v4 ?? { band: r.expected_band, vow: r.expected_vow ?? null };
const pass = lab.results.filter((r) => r.outcome === "PASS").length;
const superseded = lab.results.filter((r) => r.outcome !== "PASS" && sup.cases[r.id] && r.actual.band === expected(r).band).length;

export function perVow() {
  const VOWS = ["null_payee", "age", "kinship", "history", "identity", "silence"];
  return VOWS.map((v) => {
    const exp = lab.results.filter((r) => expected(r).vow === v).map((r) => r.id);
    const fired = lab.results.filter((r) => (r.actual.vows_fired ?? []).includes(v)).map((r) => r.id);
    const tp = exp.filter((id) => fired.includes(id)).length;
    const fp = fired.filter((id) => !exp.includes(id)).length;
    const fn = exp.length - tp;
    return { vow: v, cases: exp.length, p: tp + fp ? tp / (tp + fp) : null, r: tp + fn ? tp / (tp + fn) : null, also: fired.filter((id) => !exp.includes(id)) };
  });
}

// BaseScan agreement (one payee, observed by hand, fixtures/validation)
const bs = JSON.parse(readFileSync(join(ROOT, "fixtures", "validation", "basescan-2026-11-08.json"), "utf8"));
const smoke = JSON.parse(readFileSync(join(ROOT, "fixtures", "surf", "smoke-2payees.json"), "utf8")) as { rows: Record<string, any>[] };
const row = smoke.rows.find((r) => r.payee === bs.payee)!;
const firstSeenDeltaS = Math.abs(row.first_inbound_at - Date.parse(bs.observed.first_seen) / 1000);
const short = String(bs.observed.first_funder_shortened).toLowerCase();
const [head, tail] = short.split("…");
const funderMatch = String(row.first_inbound_from).startsWith(head!) && String(row.first_inbound_from).endsWith(tail!);
const surfCount = (row.inbound_count ?? 0) + (row.outbound_count ?? 0);
const countDelta = (100 * (surfCount - bs.observed.erc20_transfer_count)) / bs.observed.erc20_transfer_count;

// label coverage, before and after this pass's re-ask (checkpoint)
// the served census's checkpoint: the 13 Nov refresh when committed, else 9 Nov
const cpFile = existsSync(join(ROOT, "fixtures", "audit", "checkpoint-sample-census-r2-w90.json")) ? "checkpoint-sample-census-r2-w90.json" : "checkpoint-sample-census-w90.json";
const cp = JSON.parse(readFileSync(join(ROOT, "fixtures", "audit", cpFile), "utf8")) as { labels: { address: string; entity_name?: string | null; entity_type?: string | null }[]; labels_done: string[] };
const queried = new Set(cp.labels_done.map((a) => a.toLowerCase()));
const named = new Set(cp.labels.filter((l) => l.entity_name || l.entity_type).map((l) => l.address.toLowerCase()));
const anyRow = new Set(cp.labels.map((l) => l.address.toLowerCase()));
const c = loadCensus();
const reasked = new Set(c.funders.filter((f) => f.kinship_fires).map((f) => f.funder));
const namedByReask = [...reasked].filter((a) => named.has(a)).length;

// verdictable coverage: required signals complete (silence does not fire)
const verdictable = c.payees.filter((p) => !evaluateVows({ signals: c.signals.get(p.payee)!, price: p.price_usd, funder_labels: c.funderLabels }).find((r) => r.vow === "silence")!.fired).length;

const sens = sensitivity();
const B = sens.policies.B.BLOCK;
const C = sens.policies.C.BLOCK;
const pct = (x: number | null) => (x === null ? "n/a" : `${(100 * x).toFixed(0)}%`);

const rows: [string, string, string][] = [
  ["Lab pass rate", `${pass + superseded}/${lab.results.length} (${pass} pass, ${superseded} superseded)`, `${labFile}, ${lab.ran_at.slice(0, 10)}; supersession in fixtures/lab/supersessions.json`],
  ...perVow().map((v) => [`Vow ${v.vow}: precision / recall`, v.cases ? `${pct(v.p)} / ${pct(v.r)} (${v.cases} case${v.cases === 1 ? "" : "s"})${v.also.length ? `, also fired on ${v.also.join(", ")}` : ""}` : "no lab case", "lab, against current-rule expectations"] as [string, string, string]),
  ["False-block rate, upper bound", `at most ${pct((B - C) / Math.max(1, B))} (${B - C} of ${B} BLOCKs)`, "Policy C: if every unnamed shared funder were an exchange (artifacts/sensitivity.md)"],
  ["BaseScan: first-seen time", `${firstSeenDeltaS} s apart`, `one payee (${bs.endpoint}), fixtures/validation/basescan-2026-11-08.json`],
  ["BaseScan: first funder", funderMatch ? "match" : "MISMATCH", "same payee"],
  ["BaseScan: transfer count", `${surfCount} vs ${bs.observed.erc20_transfer_count} (${countDelta >= 0 ? "+" : ""}${countDelta.toFixed(1)}%)`, "same payee; BaseScan hides spam tokens by default"],
  ["Label coverage", `any row returned: ${anyRow.size} of ${queried.size} (${((100 * anyRow.size) / queried.size).toFixed(1)}%); with a name or type: ${named.size} (${((100 * named.size) / queried.size).toFixed(1)}%)`, `fixtures/audit/${cpFile}; ${namedByReask} of the ${reasked.size} funders that fire kinship have a name or type`],
  ["Verdictable coverage", `${verdictable} of ${c.payees.length} (${((100 * verdictable) / c.payees.length).toFixed(1)}%)`, "census payees with every required signal (silence does not fire)"],
];

export const winrate = { rows, summary: `Win rate: lab ${pass + superseded}/${lab.results.length} (${superseded} superseded) · false-block rate at most ${pct((B - C) / Math.max(1, B))} · BaseScan first seen ${firstSeenDeltaS} s, funder ${funderMatch ? "match" : "mismatch"}, transfers ${countDelta >= 0 ? "+" : ""}${countDelta.toFixed(1)}% · ${((100 * verdictable) / c.payees.length).toFixed(1)}% of the census verdictable (\`npx tsx scripts/winrate.ts\`).` };

if (process.argv[1]?.endsWith("winrate.ts")) {
  const md = [`| measure | value | source |`, `|---|---|---|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
  console.log(md + "\n\n" + winrate.summary);
  if (process.argv.includes("--write"))
    writeFileSync(
      join(ROOT, "artifacts", "winrate.md"),
      `# Win rate\n\nGenerated by \`npx tsx scripts/winrate.ts --write\` from committed data only (0 credits).\n\n${md}\n\n${winrate.summary}\n\nThe false-block figure is a bound, not a measurement: it assumes the worst about every shared funder Surf could not name. The BaseScan comparison covers one payee, read by hand.\n`,
    );
}
