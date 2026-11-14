/**
 * Census state for the API and the index, built at startup from COMMITTED fixtures only (0 credits, works from a fresh
 * clone): the 90-day sample + checkpoint -> scored set (current rubric) -> one deterministic sealed receipt per payee.
 * Receipts use the census time as checked_at, so receipt ids are stable across restarts and verifiable.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, nowMs, replayMode, staleHours } from "./config.js";
import { ageHours, POLICY_VERSION, staleCap, type BandCap } from "./core/cap.js";
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

/** The census receipts issued under one sample + checkpoint. */
interface Issued {
  at: string;
  sample: Sample;
  set: ReturnType<typeof scoredSet>;
  payees: CensusPayee[];
  receipts: Map<string, Receipt>;
  ledger: Receipt[];
}

const AUDIT_DIR = join(ROOT, "fixtures", "audit");
/** The first census (2026-11-09, 800 payees, policy v4). Kept unchanged: its receipts must keep verifying. */
export const CENSUS_V4_SAMPLE = join(AUDIT_DIR, "sample-census.json");
/** The refresh (2026-11-13, policy v5, per-record as_of). Used when its checkpoint is committed. */
export const CENSUS_R2_SAMPLE = join(AUDIT_DIR, "sample-census-r2.json");

/**
 * Score one sample + checkpoint and seal one receipt per payee. v4: as before (checked_at = run time, no policy fields),
 * so the 800 original receipt ids never change. v5: checked_at and as_of are the record's own collection time, and the
 * receipt carries its policy version and band basis (score band, vow band; no model ran; no cap at issue).
 */
function issue(samplePath: string, version: "v4" | "v5"): Issued {
  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as Sample;
  const cp = JSON.parse(readFileSync(checkpointPath(samplePath, CENSUS_DAYS), "utf8"));
  const at = (cp.calls as { label: string; at: string }[]).filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop()!;
  const asOfOf = (cp.payee_as_of ?? {}) as Record<string, string>;
  const set = scoredSet(sample, cp, at);
  const meta = new Map(sample.payees.map((p) => [p.payee, p]));
  const snapshotId = version === "v4" ? hashOf({ census: "w90", at, payees: set.scored.length }) : hashOf({ census: "w90-r2", at, payees: set.scored.length });
  const ledger: Receipt[] = [];
  const receipts = new Map<string, Receipt>();
  const payees: CensusPayee[] = [];
  let prev = "genesis";
  for (const e of set.scored) {
    const m = meta.get(e.s.payee)!;
    const asOf = version === "v5" ? (asOfOf[e.s.payee] ?? at) : at;
    const v5: Partial<Receipt> =
      version === "v5"
        ? { policy_version: POLICY_VERSION, as_of: asOf, band_basis: { score_band: e.r.score_band, model_band: "ALLOW", vow_band: e.r.vow_band, cap_band: "ALLOW" } }
        : {};
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
        checked_at: asOf,
        settlement: "dry-run",
        enrichment: { status: "skipped", reason: "census policy band: deterministic score + vows, no model calls" },
        ...v5,
      },
      prev,
    );
    prev = r.receipt_hash;
    ledger.push(r);
    receipts.set(r.receipt_hash, r);
    payees.push({ chain: "eip155:8453", payee: e.s.payee, url: m.example_url, service: m.service, price_usd: m.price_usd, band: e.r.band, issued_band: e.r.band, as_of: asOf, data_age_hours: 0, stale: false, band_cap: null, verdict_confidence: "normal", score: e.r.score, vows: e.r.fired, identity: e.s.identity, first_funder: e.s.first_funder, receipt_id: r.receipt_hash });
  }
  return { at, sample, set, payees, receipts, ledger };
}

let legacy: Issued | null = null;
/** The v4 census (2026-11-09): its receipts, chain and issued bands, for verification only. */
export function legacyCensus(): Issued {
  setWindowDays(CENSUS_DAYS);
  return (legacy ??= issue(CENSUS_V4_SAMPLE, "v4"));
}

function loadBaseCensus(): Census {
  if (base) return base;
  setWindowDays(CENSUS_DAYS);
  // fixture mode replays model answers recorded against the 9 Nov census: it serves that census, never the refresh
  const refreshed = !replayMode() && existsSync(checkpointPath(CENSUS_R2_SAMPLE, CENSUS_DAYS));
  const cur = refreshed ? issue(CENSUS_R2_SAMPLE, "v5") : legacyCensus();
  const { at, sample, set } = cur;
  const payees = [...cur.payees];
  const receipts = new Map(cur.receipts);
  if (refreshed) {
    // union by payee: a v4 record the refresh could not re-collect (scan-heavy, excluded) is kept with its own old as_of
    const have = new Set(payees.map((p) => p.payee));
    const old = legacyCensus();
    for (const p of old.payees) if (!have.has(p.payee)) payees.push(p);
    for (const [k, r] of old.receipts) receipts.set(k, r);
  }
  const ledger = cur.ledger;
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
    signals: new Map([...(refreshed ? legacyCensus().set.scored : []), ...set.scored].map((e) => [e.s.payee, e.s])),
    funderLabels: set.funderLabels,
    tokenContracts: set.tokenContracts,
  };
  return base;
}

/** Demo stats measured by `npm run localhost-check` (artifacts/demo-stats.json, committed). */
export interface DemoStats { measured_at: string; warm_p50_ms: number; cold_ms: number | null; tests_passed: number; accept: string; quality_measured_at?: string }

/** Test and gate counts from the committed data/numbers.json ("quality", measured by scripts/quality.ts). */
export function loadQuality(): { tests: number; accept_gates: string; measured_at: string } | null {
  const p = join(ROOT, "data", "numbers.json");
  try {
    return existsSync(p) ? ((JSON.parse(readFileSync(p, "utf8")) as { quality?: { tests: number; accept_gates: string; measured_at: string } }).quality ?? null) : null;
  } catch {
    return null;
  }
}
export function loadDemoStats(): DemoStats | null {
  const p = join(ROOT, "artifacts", "demo-stats.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as DemoStats) : null;
}
