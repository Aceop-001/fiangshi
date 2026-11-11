/**
 * Census state for the API and the index, built at startup from COMMITTED fixtures only (0 credits, works from a fresh
 * clone): the 90-day sample + checkpoint -> scored set (current rubric) -> one deterministic sealed receipt per payee.
 * Receipts use the census time as checked_at, so receipt ids are stable across restarts and verifiable.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.js";
import { hashOf } from "./core/canonical.js";
import { sealReceipt } from "./core/receipt.js";
import { kinshipExempt, type Band, type FunderLabel, type PayeeSignals, type Receipt } from "./core/types.js";
import { checkpointPath, scoredSet, setWindowDays, type Sample } from "../scripts/audit.js";

export const CENSUS_DAYS = 90;

export interface CensusPayee {
  payee: string;
  url: string;
  service: string | null;
  price_usd: number | null;
  band: Band;
  score: number;
  vows: string[];
  identity: PayeeSignals["identity"];
  first_funder: string | null;
  receipt_id: string;
}
export interface FunderRow {
  funder: string;
  payees: number;
  status: "exchange" | "relayer" | "shared unnamed funder";
  label: string | null;
  kinship_fires: boolean;
}
export interface Census {
  at: string;
  window_days: number;
  catalog_payees: number;
  catalog_resources: number;
  base_resources: number;
  endpoints_per_payee: number;
  payees: CensusPayee[];
  bands: Record<Band, number>;
  receipts: Map<string, Receipt>;
  ledger: Receipt[];
  funders: FunderRow[];
  signals: Map<string, PayeeSignals>;
  funderLabels: Record<string, FunderLabel>;
  /** addresses Surf typed as token contracts: never a first funder */
  tokenContracts: string[];
}

let cached: Census | null = null;

export function loadCensus(): Census {
  if (cached) return cached;
  setWindowDays(CENSUS_DAYS);
  const samplePath = join(ROOT, "fixtures", "audit", "sample-census.json");
  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as Sample;
  const cp = JSON.parse(readFileSync(checkpointPath(samplePath, CENSUS_DAYS), "utf8"));
  const at = (cp.calls as { label: string; at: string }[]).filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop()!;
  const set = scoredSet(sample, cp, at);
  const meta = new Map(sample.payees.map((p) => [p.payee, p]));
  const snapshotId = hashOf({ census: "w90", at, payees: set.scored.length });
  const ledger: Receipt[] = [];
  const receipts = new Map<string, Receipt>();
  const payees: CensusPayee[] = [];
  let prev = "genesis";
  for (const e of set.scored) {
    const m = meta.get(e.s.payee)!;
    const r = sealReceipt(
      {
        payee: e.s.payee,
        url: m.example_url,
        terms_hash: hashOf({ url: m.example_url, payee: e.s.payee, price: m.price_usd }),
        price: m.price_usd,
        band: e.r.band,
        score: e.r.score,
        vow_fired: (e.r.vow ?? null) as Receipt["vow_fired"],
        evidence: Object.entries(e.s.evidence).slice(0, 3).map(([signal, quote]) => ({ signal, quote })),
        model: { verdict: null, extractor: "census (no model)", degraded: false },
        snapshot_id: snapshotId,
        checked_at: at,
        settlement: "dry-run",
        enrichment: { status: "skipped", reason: "census policy band: deterministic score + vows, no model calls" },
      },
      prev,
    );
    prev = r.receipt_hash;
    ledger.push(r);
    receipts.set(r.receipt_hash, r);
    payees.push({ payee: e.s.payee, url: m.example_url, service: m.service, price_usd: m.price_usd, band: e.r.band, score: e.r.score, vows: e.r.fired, identity: e.s.identity, first_funder: e.s.first_funder, receipt_id: r.receipt_hash });
  }
  const bands = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<Band, number>;
  for (const p of payees) bands[p.band]++;
  const byFunder = new Map<string, string[]>();
  for (const p of payees) if (p.first_funder) (byFunder.get(p.first_funder) ?? byFunder.set(p.first_funder, []).get(p.first_funder)!).push(p.payee);
  const funders: FunderRow[] = [...byFunder.entries()]
    .filter(([, ps]) => ps.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([f, ps]) => {
      const lab = set.funderLabels[f];
      const l = set.labelOf.get(f);
      return {
        funder: f,
        payees: ps.length,
        status: lab === "cex" ? "exchange" : lab === "infra" ? "relayer" : "shared unnamed funder",
        label: lab === "cex" || lab === "infra" ? (l?.entity_name ?? null) : null, // never print a label that names a person
        kinship_fires: !kinshipExempt(lab),
      };
    });
  cached = {
    at,
    window_days: CENSUS_DAYS,
    catalog_payees: sample.catalog.distinct_base_payees,
    catalog_resources: sample.catalog.resources,
    base_resources: sample.catalog.base_resources,
    endpoints_per_payee: sample.catalog.endpoints_per_payee,
    payees,
    bands,
    receipts,
    ledger,
    funders,
    signals: new Map(set.scored.map((e) => [e.s.payee, e.s])),
    funderLabels: set.funderLabels,
    tokenContracts: set.tokenContracts,
  };
  return cached;
}

/** Demo stats measured by `npm run localhost-check` (artifacts/demo-stats.json, committed). */
export interface DemoStats { measured_at: string; warm_p50_ms: number; cold_ms: number | null; tests_passed: number; accept: string }
export function loadDemoStats(): DemoStats | null {
  const p = join(ROOT, "artifacts", "demo-stats.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as DemoStats) : null;
}
