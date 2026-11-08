/** --explain: the offline debugger. Every signal, every component, every vow, every citation check. */
import { WEIGHTS, type ComponentKey } from "../core/score.js";
import type { CheckResult } from "../check.js";

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const fmt = (v: unknown) => (v === null || v === undefined ? "MISSING" : typeof v === "number" ? String(Math.round(v * 10000) / 10000) : JSON.stringify(v));

export function explain(r: CheckResult): string {
  const d = r.decision;
  const L: string[] = [];
  L.push(`== fiangshi check --explain`);
  L.push(`url          ${r.url}`);
  L.push(`snapshot_id  ${r.snapshot_id}`);
  if (r.terms) {
    L.push(`terms        payee=${r.terms.payee} price=${fmt(r.terms.price)} USD network=${r.terms.network} asset=${r.terms.asset}`);
    L.push(`terms_hash   ${r.terms.terms_hash}`);
  } else L.push(`terms        PROBE FAILED: ${r.probe_error}`);

  L.push(``, `-- signals`);
  const s = r.signals;
  for (const k of ["wallet_age_hours", "tx_count", "first_funder", "funder_fanout", "distinct_payers", "repeat_payers", "total_received_usd", "appears_in_other_listings", "token_concentration", "dormancy_days"] as const)
    L.push(`  ${pad(k, 26)} ${fmt(s[k])}`);
  L.push(`  ${pad("identity", 26)} org=${fmt(s.identity.claims_org)} product=${fmt(s.identity.claims_product)} corroborated=${fmt(s.identity.corroborated)}`);
  L.push(`  evidence keys: ${Object.keys(s.evidence).join(", ") || "(none)"}`);

  L.push(``, `-- score components   (component x weight = contribution)`);
  for (const k of Object.keys(WEIGHTS) as ComponentKey[]) {
    const c = d.components[k];
    const contrib = (c ?? 0) * WEIGHTS[k];
    L.push(`  ${k}  ${pad(c === null ? "MISSING(0)" : c.toFixed(4), 11)} x ${pad(String(WEIGHTS[k]), 3)} = ${contrib.toFixed(2)}`);
  }
  L.push(`  score = ${d.score}  -> score band ${d.scoreBand}${d.vows.find((v) => v.vow === "silence")?.fired ? " (silence: incomplete score capped to REVIEW)" : ""}`);

  L.push(``, `-- vows   (precedence order; may only lower)`);
  for (const v of d.vows) L.push(`  ${pad(v.vow, 9)} ${v.fired ? "FIRE -> " + pad(v.band, 6) : pad("pass", 14)} ${v.reason}`);

  L.push(``, `-- model  ${r.decision.verdict.model}`);
  L.push(`  raw band: ${fmt(d.modelRawBand)}  applied: ${d.modelBand}${d.verdict.degraded ? "  (DEGRADED)" : ""}`);
  L.push(`  attempts: ${d.attempts}`);
  L.push(`  citations:`);
  const checks = d.validation?.checks ?? [];
  for (const c of checks) L.push(`    [${c.signal_exists ? "signal ok" : "NO SIGNAL"} | ${c.is_substring ? "substring ok" : "NOT SUBSTRING"}] ${c.signal}: "${c.quote}"`);
  if (checks.length === 0) L.push(`    (none)`);
  const errors = !d.validation ? ["model unreachable"] : d.validation.ok ? [] : d.validation.errors;
  for (const e of errors) L.push(`  rejected: ${e}`);

  L.push(``, `-- final`);
  L.push(`  band=${d.verdict.band} score=${d.verdict.score} vow_fired=${d.verdict.vow_fired ?? "none"} degraded=${d.verdict.degraded}`);
  L.push(`  receipt_hash=${r.receipt.receipt_hash}`);
  return L.join("\n");
}
