/**
 * Census state for the API and the index, built at startup from COMMITTED fixtures only (0 credits, works from a fresh
 * clone): the 90-day sample + checkpoint -> scored set (current rubric) -> one deterministic sealed receipt per payee.
 * Receipts use the census time as checked_at, so receipt ids are stable across restarts and verifiable.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, nowMs, staleHours } from "./config.js";
import { ageHours, staleCap, type BandCap } from "./core/cap.js";
import { hashOf } from "./core/canonical.js";
import { sealReceipt } from "./core/receipt.js";
import { kinshipExempt, type Band, type FunderLabel, type PayeeSignals, type Receipt } from "./core/types.js";
import { checkpointPath, scoredSet, setWindowDays, type Sample } from "../scripts/audit.js";

export const CENSUS_DAYS = 90;

export interface CensusPayee {
  /** CAIP-2 chain (Base only) */
  chain: "eip155:8453";
  payee: string;
  url: string;
  service: string | null;
  price_usd: number | null;
  /** the band served now: the issued band after band caps (policy v5). Can only be lower than issued_band. */
  band: Band;
  /** the band the census receipt was issued with (policy v4, no caps) */
  issued_band: Band;
  /** when this payee's data was collected (ISO-8601): per record, never one stamp for the whole run */
  as_of: string;
  data_age_hours: number;
  stale: boolean;
  band_cap: BandCap | null;
  verdict_confidence: "normal" | "degraded";
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
  /** bands served now (after caps) */
  bands: Record<Band, number>;
  /** bands as issued on the census receipts (policy v4) */
  issued_bands: Record<Band, number>;
  /** when this view was computed, and the freshness of its records */
  served_at: string;
  payees_stale: number;
  oldest_as_of: string;
  newest_as_of: string;
  stale_limit_hours: number;
  receipts: Map<string, Receipt>;
  ledger: Receipt[];
  funders: FunderRow[];
  signals: Map<string, PayeeSignals>;
  funderLabels: Record<string, FunderLabel>;
  /** addresses Surf typed as token contracts: never a first funder */
  tokenContracts: string[];
}

let base: Census | null = null;
let served: { minute: number; limit: number; census: Census } | null = null;

/**
 * The census as served now: each record's band capped by its own age (policy v5). Recomputed at most once a minute,
 * so a long-running server never serves an ALLOW whose data has crossed the limit.
 */
export function loadCensus(): Census {
  const b = loadBaseCensus();
  const now = nowMs();
  const minute = Math.floor(now / 60_000);
  const limit = staleHours();
  if (served && served.minute === minute && served.limit === limit) return served.census;
  const payees = b.payees.map((p) => {
    const age = ageHours(p.as_of, now);
    const cap = staleCap(p.issued_band, age, limit);
    return { ...p, band: cap.band, data_age_hours: age, stale: age > limit, band_cap: cap.band_cap, verdict_confidence: cap.verdict_confidence };
  });
  const bands = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<Band, number>;
  for (const p of payees) bands[p.band]++;
  const census: Census = { ...b, payees, bands, served_at: new Date(now).toISOString(), payees_stale: payees.filter((p) => p.stale).length, stale_limit_hours: limit };
  served = { minute, limit, census };
  return census;
}

function loadBaseCensus(): Census {
  if (base) return base;
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
    payees.push({ chain: "eip155:8453", payee: e.s.payee, url: m.example_url, service: m.service, price_usd: m.price_usd, band: e.r.band, issued_band: e.r.band, as_of: at, data_age_hours: 0, stale: false, band_cap: null, verdict_confidence: "normal", score: e.r.score, vows: e.r.fired, identity: e.s.identity, first_funder: e.s.first_funder, receipt_id: r.receipt_hash });
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
  const asOfs = payees.map((p) => p.as_of).sort();
  base = {
    at,
    window_days: CENSUS_DAYS,
    catalog_payees: sample.catalog.distinct_base_payees,
    catalog_resources: sample.catalog.resources,
    base_resources: sample.catalog.base_resources,
    endpoints_per_payee: sample.catalog.endpoints_per_payee,
    payees,
    bands,
    issued_bands: { ...bands },
    served_at: at,
    payees_stale: 0,
    oldest_as_of: asOfs[0] ?? at,
    newest_as_of: asOfs[asOfs.length - 1] ?? at,
    stale_limit_hours: staleHours(),
    receipts,
    ledger,
    funders,
    signals: new Map(set.scored.map((e) => [e.s.payee, e.s])),
    funderLabels: set.funderLabels,
    tokenContracts: set.tokenContracts,
  };
  return base;
}

/** Demo stats measured by `npm run localhost-check` (artifacts/demo-stats.json, committed). */
export interface DemoStats { measured_at: string; warm_p50_ms: number; cold_ms: number | null; tests_passed: number; accept: string }
export function loadDemoStats(): DemoStats | null {
  const p = join(ROOT, "artifacts", "demo-stats.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as DemoStats) : null;
}
