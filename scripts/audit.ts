/**
 * Payee audit over the x402 Bazaar catalog. Mechanical: enumerate -> dedupe -> sample -> probe -> batched Surf -> report.
 *
 *   npx tsx scripts/audit.ts sample [--n 200]        0 credits. data/bazaar/resources.jsonl -> fixtures/audit/sample.json
 *   npx tsx scripts/audit.ts probe                   0 credits. one unpaid GET per sampled payee, 1 req/sec -> fixtures/audit/probes.jsonl
 *   npx tsx scripts/audit.ts run                     credits. 3 SQL + ceil(addresses/100) label calls -> fixtures/audit/raw.json
 *   npx tsx scripts/audit.ts report [--raw f] [--labels f]   0 credits -> artifacts/audit.md
 *
 * Sample = Base (eip155:8453) payees, deduped, ordered by sha256(payee): reproducible and unbiased by catalog order.
 * `run` refuses to start if the estimated credits exceed what is left of today's free tier (from artifacts/costs.md),
 * unless SURF_API_KEY is set.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse402 } from "../src/adapters/probe.js";
import { funderLabelsFromSurf, signalsFromSurf, type SurfPayeeRow, type SurfWalletLabel } from "../src/adapters/surf.js";
import { sha256 } from "../src/core/canonical.js";
import { components, score } from "../src/core/score.js";
import { decidingVow, evaluateVows } from "../src/core/vows.js";
import { bandForScore, minBand, type Band, type PayeeSignals } from "../src/core/types.js";
import { loadDotEnv } from "../src/config.js";
import { computeFanout } from "../src/snapshot.js";
import { guarded } from "./budget.js";
import { runSync } from "./surf/payee-facts.js";

const ROOT = join(import.meta.dirname, "..");
const AUD = join(ROOT, "fixtures", "audit");
const SURF = process.env.SURF_BIN ?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".local", "bin", "surf.exe");
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const FREE_PER_DAY = 30;
const DAYS = 365;

interface CatalogRow { resource: string | null; serviceName: string | null; network: string | null; payTo: string | null; amount: string | null; asset: string | null }
export interface SamplePayee { payee: string; resources: number; example_url: string; service: string | null; price_usd: number | null }
export interface Sample {
  method: string;
  catalog: { resources: number; base_resources: number; base_usdc_resources: number; distinct_base_payees: number; endpoints_per_payee: number; top_payees: { payee: string; resources: number }[] };
  payees: SamplePayee[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const readJsonl = <T>(p: string): T[] => readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as T);

// ---------- sample (0 credits)
export function buildSample(rows: CatalogRow[], n: number): Sample {
  const base = rows.filter((r) => r.network === "eip155:8453" && r.payTo && /^0x[0-9a-f]{40}$/.test(r.payTo));
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
    method: `Base (eip155:8453) payTo from the x402 Bazaar catalog, deduped, ordered by sha256(payee), first ${n}`,
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

// ---------- probe (0 credits)
async function probeSample(sample: Sample): Promise<void> {
  const out = join(AUD, "probes.jsonl");
  writeFileSync(out, "");
  for (const p of sample.payees) {
    let line: Record<string, unknown> = { payee: p.payee, url: p.example_url };
    try {
      const res = await fetch(p.example_url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      const text = await res.text();
      let body: unknown = text.slice(0, 4000);
      try {
        body = JSON.parse(text);
      } catch {
        /* keep text */
      }
      const parsed = parse402({ url: p.example_url, status: res.status, headers, body });
      line = { ...line, status: res.status, parsed: parsed.ok, live_payee: parsed.ok ? parsed.terms.payee : null, payee_matches_catalog: parsed.ok ? parsed.terms.payee === p.payee : null, price: parsed.ok ? parsed.terms.price : null, error: parsed.ok ? null : parsed.error };
    } catch (e) {
      line = { ...line, status: null, parsed: false, error: (e as Error).message.slice(0, 120) };
    }
    appendFileSync(out, JSON.stringify(line) + "\n");
    await sleep(1000);
  }
}

// ---------- run (credits)
function creditsUsedTodayUtc(): number {
  const p = join(ROOT, "artifacts", "costs.md");
  if (!existsSync(p)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.startsWith(`| ${today}`) && l.includes("| surf |"))
    .reduce((a, l) => a + (Number(l.split("|")[5]?.trim()) || 0), 0);
}

function labelsCall(addrs: string[]): Promise<{ data: SurfWalletLabel[]; credits: number | null }> {
  return guarded("surf", `wallet-labels-batch n=${addrs.length}`, async () => {
    const r = spawnSync(SURF, ["wallet-labels-batch", "--addresses", addrs.join(","), "--json"], { encoding: "utf8", timeout: 60_000 });
    const j = JSON.parse(r.stdout || "{}") as { error?: { code: string; message: string }; meta?: { credits_used?: number }; data?: SurfWalletLabel[] };
    if (j.error) throw new Error(`${j.error.code}: ${j.error.message}`);
    return { value: { data: j.data ?? [], credits: j.meta?.credits_used ?? null }, units: j.meta?.credits_used ?? null };
  });
}

async function runAudit(sample: Sample): Promise<void> {
  const payees = sample.payees.map((p) => p.payee);
  const labelCallsMax = Math.ceil((payees.length * 2) / 100);
  const estimate = 3 * 5 + labelCallsMax * 1;
  const used = creditsUsedTodayUtc();
  if (!process.env.SURF_API_KEY && used + estimate > FREE_PER_DAY)
    throw new Error(`free tier: ${used} credits used today (UTC), run needs ~${estimate}; ${FREE_PER_DAY - used} left. Retry after 00:00 UTC or set SURF_API_KEY.`);
  console.log(`estimate ~${estimate} credits (used today ${used}/${FREE_PER_DAY})`);

  const t0 = Date.now();
  const payeePass = await runSync(payees, DAYS); // inbound + outbound over all payees: 2 calls
  const funders = [...new Set(payeePass.rows.map((r) => String(r.first_inbound_from ?? "")).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
  const funderPass = funders.length ? await runSync(funders, DAYS, ["payee-outbound"]) : { calls: [], rows: [] }; // 1 call
  const addrs = [...new Set([...payees, ...funders])];
  const labels: SurfWalletLabel[] = [];
  const labelCredits: (number | null)[] = [];
  for (let i = 0; i < addrs.length; i += 100) {
    const r = await labelsCall(addrs.slice(i, i + 100));
    labels.push(...r.data);
    labelCredits.push(r.credits);
  }
  const raw = {
    ran_at: new Date().toISOString(),
    days: DAYS,
    ms: Date.now() - t0,
    credits: { payee_calls: payeePass.calls.map((c) => c.credits), funder_calls: funderPass.calls.map((c) => c.credits), label_calls: labelCredits },
    rows: payeePass.rows,
    funder_rows: funderPass.rows,
    labels,
  };
  writeFileSync(join(AUD, "raw.json"), JSON.stringify(raw, null, 1) + "\n");
  console.log(`run done in ${raw.ms}ms credits=${JSON.stringify(raw.credits)}`);
}

// ---------- report (0 credits)
export interface AuditRaw { ran_at: string; days: number; rows: SurfPayeeRow[]; funder_rows: SurfPayeeRow[]; labels: SurfWalletLabel[]; credits?: unknown; ms?: number }

const AGE_BUCKETS: [string, number][] = [["< 48h", 48], ["48h – 7d", 168], ["7 – 30d", 720], ["30 – 90d", 2160], ["90 – 365d", 8760]];

export function auditReport(sample: Sample, raw: AuditRaw, probes: Record<string, unknown>[] = []): string {
  const now = Math.floor(Date.parse(raw.ran_at) / 1000);
  const windowStart = now - raw.days * 86_400;
  const outByFunder = Object.fromEntries(raw.funder_rows.map((r) => [r.payee.toLowerCase(), r.distinct_outbound_receivers ?? 0]));
  const { labels: funderLabels, tokenContracts } = funderLabelsFromSurf(raw.labels, outByFunder);
  const labelOf = new Map(raw.labels.map((l) => [l.address.toLowerCase(), l]));
  const rowOf = new Map(raw.rows.map((r) => [r.payee.toLowerCase(), r]));
  const priceOf = new Map(sample.payees.map((p) => [p.payee, p.price_usd]));

  let signals: PayeeSignals[] = sample.payees.map((p) => {
    const l = labelOf.get(p.payee);
    return signalsFromSurf(rowOf.get(p.payee) ?? { payee: p.payee }, {
      now,
      windowStart,
      tokenContracts,
      identity: l?.entity_name ? { claims_org: l.entity_name, corroborated: true } : undefined,
    });
  });
  const fan = computeFanout(signals, { labels: funderLabels, edges: {} });
  signals = signals.map((s) => (s.first_funder ? { ...s, funder_fanout: fan.get(s.payee) ?? 0 } : s));

  const evals = signals.map((s) => {
    const price = priceOf.get(s.payee) ?? null;
    const sc = score(components(s, funderLabels));
    const rows = evaluateVows({ signals: s, price, funder_labels: funderLabels });
    const silence = rows.find((r) => r.vow === "silence")!.fired;
    const dv = decidingVow(rows);
    const band: Band = minBand(silence ? "REVIEW" : bandForScore(sc), dv?.band ?? "ALLOW");
    return { s, sc, band, vow: dv?.vow ?? null, fired: rows.filter((r) => r.fired).map((r) => r.vow) };
  });

  const n = signals.length;
  const active = signals.filter((s) => s.wallet_age_hours !== null);
  const floored = active.filter((s) => s.wallet_age_hours! >= (now - windowStart) / 3600 - 24);
  const buckets = AGE_BUCKETS.map(([name, max], i) => {
    const min = i === 0 ? 0 : AGE_BUCKETS[i - 1]![1];
    return [name, active.filter((s) => s.wallet_age_hours! >= min && s.wallet_age_hours! < max && !floored.includes(s)).length] as const;
  });
  const pct = (x: number) => `${((100 * x) / Math.max(1, n)).toFixed(1)}%`;

  const clusters = new Map<string, string[]>();
  for (const s of signals) if (s.first_funder && funderLabels[s.first_funder] !== "cex") (clusters.get(s.first_funder) ?? clusters.set(s.first_funder, []).get(s.first_funder)!).push(s.payee);
  const multi = [...clusters.entries()].filter(([, ps]) => ps.length >= 2).sort((a, b) => b[1].length - a[1].length);
  const cexFunded = signals.filter((s) => s.first_funder && funderLabels[s.first_funder] === "cex");
  const viaLabel = cexFunded.filter((s) => labelOf.get(s.first_funder!)?.entity_type?.toLowerCase() === "cex").length;

  const bands = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<Band, number>;
  evals.forEach((e) => bands[e.band]++);
  const vowCount = new Map<string, number>();
  evals.forEach((e) => e.fired.forEach((v) => vowCount.set(v, (vowCount.get(v) ?? 0) + 1)));
  const concOne = signals.filter((s) => s.token_concentration !== null && s.token_concentration >= 0.99).length;

  const probed = probes.length;
  const p402 = probes.filter((p) => p.status === 402).length;
  const pParsed = probes.filter((p) => p.parsed === true).length;
  const rotated = probes.filter((p) => p.payee_matches_catalog === false);

  const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
  const L: string[] = [];
  L.push(`# Payee audit — x402 Bazaar, Base`, ``);
  L.push(`Generated by \`npx tsx scripts/audit.ts report\` from \`fixtures/audit/{sample.json,raw.json,probes.jsonl}\`. Surf data as of ${raw.ran_at} (${raw.days}-day window).`, ``);
  L.push(`## Catalog`, ``);
  L.push(`| metric | value |`, `|---|---|`);
  L.push(`| catalog resources | ${sample.catalog.resources} |`, `| Base resources | ${sample.catalog.base_resources} (${sample.catalog.base_usdc_resources} priced in USDC) |`);
  L.push(`| distinct Base payees | ${sample.catalog.distinct_base_payees} |`, `| **endpoints → payees ratio** | **${sample.catalog.endpoints_per_payee} resources per payee** |`);
  L.push(`| largest payee | ${sample.catalog.top_payees[0] ? `${short(sample.catalog.top_payees[0].payee)} with ${sample.catalog.top_payees[0].resources} resources` : "-"} |`, ``);
  L.push(`Sample: ${sample.method} → **${n} payees**.`, ``);
  if (probed) {
    L.push(`## Live probes (1 unpaid GET per sampled payee)`, ``);
    L.push(`${probed} probed · ${p402} returned 402 · ${pParsed} parsed · **${rotated.length} payee mismatches** (live payTo ≠ catalog payTo).`, ``);
    const dist: Record<string, number> = {};
    probes.forEach((p) => (dist[String(p.status ?? "error")] = (dist[String(p.status ?? "error")] ?? 0) + 1));
    L.push(`Status distribution: ${Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s}: ${c}`).join(" · ")}. 405 = POST-only resource probed with GET; 404 = dead listing; 200 = served without a paywall; ${p402 - pParsed} returned 402 in a shape the parser rejects (kept as REVIEW, not guessed).`, ``);
    for (const r of rotated.slice(0, 10)) L.push(`- ${r.url}: catalog ${short(String(r.payee))} → live ${short(String(r.live_payee))}`);
    if (rotated.length) L.push(``);
  }
  L.push(`## Wallet age (lower bound — first transfer within the ${raw.days}-day window)`, ``);
  L.push(`| bucket | payees | share |`, `|---|---|---|`);
  for (const [b, c] of buckets) L.push(`| ${b} | ${c} | ${pct(c)} |`);
  L.push(`| ≥ ${raw.days}d (floored at window start) | ${floored.length} | ${pct(floored.length)} |`, `| no transfers in window | ${n - active.length} | ${pct(n - active.length)} |`, ``);
  L.push(`## Funder clusters (exchanges excluded)`, ``);
  L.push(`Exchange exclusion: ${cexFunded.length} payees CEX-funded (${viaLabel} by Surf \`entity_type: cex\` label, ${cexFunded.length - viaLabel} by fanout ≥ 500 heuristic). Token contracts as "first funder": ${tokenContracts.length} (treated as missing).`, ``);
  L.push(`Clusters are 1-hop (shared direct first funder) within the sample; the kinship vow fires at ≥ 3 *other* payees.`, ``);
  if (multi.length) {
    L.push(`| funder | payees | kinship fires |`, `|---|---|---|`);
    for (const [f, ps] of multi.slice(0, 15)) L.push(`| ${short(f)} | ${ps.length} | ${ps.length >= 4 ? "yes" : "no"} |`);
  } else L.push(`No shared non-exchange funders in the sample.`);
  L.push(``, `## Policy bands (deterministic score + vows, no model)`, ``);
  L.push(`| band | payees | share |`, `|---|---|---|`);
  for (const b of ["ALLOW", "REVIEW", "BLOCK"] as Band[]) L.push(`| ${b} | ${bands[b]} | ${pct(bands[b])} |`);
  L.push(``, `Vows fired: ${[...vowCount.entries()].map(([v, c]) => `${v} ${c}`).join(" · ") || "none"}.`, ``);
  L.push(`## Caveats`, ``);
  L.push(`- Age is a floor: ${floored.length} payees sit at the window start, so their true age is ≥ ${raw.days}d. The 48h age vow is unaffected.`);
  L.push(`- E (exposure) proxy: ${concOne}/${active.length} active payees have ≥ 99% of inbound USD in one token. x402 sellers are paid in USDC by design, so this proxy costs nearly every seller the full 10 points of E — it is not discriminative and should be redefined before scoring is trusted.`);
  L.push(`- Identity is corroborated only where Surf has an \`entity_name\` label; Dolphin claim extraction is not wired yet.`);
  return L.join("\n") + "\n";
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (k: string) => {
    const i = rest.indexOf(k);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  mkdirSync(AUD, { recursive: true });
  const samplePath = join(AUD, "sample.json");
  if (cmd === "sample") {
    const s = buildSample(readJsonl<CatalogRow>(join(ROOT, "data", "bazaar", "resources.jsonl")), Number(flag("--n") ?? 200));
    writeFileSync(samplePath, JSON.stringify(s, null, 1) + "\n");
    console.log(JSON.stringify(s.catalog, null, 1), `\nsample: ${s.payees.length} payees -> ${samplePath}`);
  } else if (cmd === "probe") {
    await probeSample(JSON.parse(readFileSync(samplePath, "utf8")) as Sample);
    console.log("probes -> fixtures/audit/probes.jsonl");
  } else if (cmd === "run") {
    await runAudit(JSON.parse(readFileSync(samplePath, "utf8")) as Sample);
  } else if (cmd === "report") {
    const sample = JSON.parse(readFileSync(flag("--sample") ?? samplePath, "utf8")) as Sample;
    const raw = JSON.parse(readFileSync(flag("--raw") ?? join(AUD, "raw.json"), "utf8")) as AuditRaw;
    const pp = join(AUD, "probes.jsonl");
    const probes = existsSync(pp) && !flag("--sample") ? readJsonl<Record<string, unknown>>(pp) : [];
    const out = flag("--out") ?? join(ROOT, "artifacts", "audit.md");
    writeFileSync(out, auditReport(sample, raw, probes));
    console.log(`report -> ${out}`);
  } else {
    console.error("usage: audit.ts sample [--n N] | probe | run | report [--sample f --raw f --out f]");
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
