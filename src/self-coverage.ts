/**
 * H (post-deadline): the service's own payTo, ranked from Base chain logs. Not a census record and never inserted
 * into the census: `payees_total` and the coverage line stay Surf-derived. Read once from a committed fixture written
 * by scripts/self-coverage.ts (build time, 0 Surf credits); never fetched on the request path.
 *
 * Ranked honestly: the logs become the same SurfPayeeRow shape the census uses, then the unchanged census policy
 * (`policyBand`: score, six vows, v2 exposure, 90-day window) and the unchanged stale cap. No weight, threshold or vow
 * is special-cased for this address. The one difference from a census record is the source: USDC Transfer logs only,
 * where Surf's base_transfers covers every token, and no Surf wallet label.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, nowMs, staleHours } from "./config.js";
import { ageHours, POLICY_VERSION, staleCap, type BandCap } from "./core/cap.js";
import type { Band, FunderLabel, PayeeSignals } from "./core/types.js";
import { signalsFromSurf, type SurfPayeeRow } from "./adapters/surf.js";
import { policyBand } from "./policy.js";
import { CENSUS_DAYS } from "./census.js";

/** The live service's payTo, as its own 402 names it (api.fiangshi.xyz/v1/check, checked 2026-11-19). */
export const SELF_PAYEE = "0x0FdEe24dbc6EDCa4316312C7461658F4A26e6007";
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const SELF_COVERAGE_FILE = "fixtures/self-coverage.json";
/** What the live 402 asks for a cached check (amount 50000, 6 decimals): the price the history vow sees. */
export const SELF_PRICE_USD = 0.05;

export interface LogTransfer {
  block: number;
  time: string;
  counterparty: string;
  usd: number;
  tx: string;
  log_index: number;
}
export interface SelfCoverageFile {
  payee: string;
  chain: "eip155:8453";
  asset: string;
  source: "base-logs";
  rpc: string;
  as_of: string;
  /** days actually scanned; less than the census window when the public RPC keeps less history */
  window_days: number;
  window_start: string;
  window_limited_by: string | null;
  archive_rpc: string;
  /** state at the window start (archive node): activity before the window would show here */
  prior_nonce: number | null;
  prior_usdc: number | null;
  from_block: number;
  to_block: number;
  chunk_blocks: number;
  rpc_calls: number;
  has_code: boolean;
  nonce: number;
  inbound: LogTransfer[];
  outbound: LogTransfer[];
}

export interface SelfCoverage {
  payee: string;
  inbound_transfers: number;
  inbound_usd: number;
  distinct_payers: number;
  first_seen: string | null;
  last_seen: string | null;
  source: "base-logs";
  as_of: string;
  in_census: boolean;
  /** ranked by the census policy, unchanged */
  band: Band;
  issued_band: Band;
  score: number;
  vows: string[];
  deciding_vow: string | null;
  band_cap: BandCap | null;
  policy_version: string;
  scanned_days: number;
  window_limited_by: string | null;
  prior_state: { nonce: number | null; usdc: number | null };
  basis: string;
  fixture: string;
}

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** The log facts as a census row (the shape Surf returns), so the census signal code runs on them unchanged. */
export function rowFromLogs(f: SelfCoverageFile): SurfPayeeRow {
  const row: SurfPayeeRow = { payee: f.payee.toLowerCase(), inbound_count: f.inbound.length, outbound_count: f.outbound.length };
  if (f.inbound.length) {
    const bySender = new Map<string, number>();
    for (const t of f.inbound) bySender.set(t.counterparty, (bySender.get(t.counterparty) ?? 0) + t.usd);
    const total = f.inbound.reduce((n, t) => n + t.usd, 0);
    Object.assign(row, {
      first_inbound_at: unix(f.inbound[0]!.time),
      last_inbound_at: unix(f.inbound[f.inbound.length - 1]!.time),
      distinct_inbound_senders: bySender.size,
      first_inbound_from: f.inbound[0]!.counterparty,
      inbound_usd: total,
      top_payer_share: total > 0 ? Math.max(...bySender.values()) / total : null,
      top_token_share: null, // informational only; one token scanned
    });
  }
  if (f.outbound.length)
    Object.assign(row, {
      first_outbound_at: unix(f.outbound[0]!.time),
      last_outbound_at: unix(f.outbound[f.outbound.length - 1]!.time),
      distinct_outbound_receivers: new Set(f.outbound.map((t) => t.counterparty)).size,
    });
  return row;
}

/** Pure: the logs, the census's signals and funder labels, and now -> the self_coverage block. */
export function selfCoverage(f: SelfCoverageFile, census: { payees: { payee: string }[]; signals: Map<string, PayeeSignals>; funderLabels: Record<string, FunderLabel> }, now: number, limitHours: number): SelfCoverage {
  const payee = f.payee.toLowerCase();
  const s0 = signalsFromSurf(rowFromLogs(f), { now: unix(f.as_of), windowStart: unix(f.window_start), tokenContracts: [], identity: { claims_org: null, corroborated: null } });
  // kinship: how many census payees share this first funder (1 hop; the census adds labelled ancestors)
  const fanout = s0.first_funder ? [...census.signals.values()].filter((x) => x.payee !== payee && x.first_funder === s0.first_funder).length : null;
  const s: PayeeSignals = { ...s0, funder_fanout: fanout };
  // ranked on the census window (90 days), never on the shorter scanned window: a short window would credit maturity
  const r = policyBand(s, SELF_PRICE_USD, census.funderLabels, "v2", CENSUS_DAYS * 24);
  const cap = staleCap(r.band, ageHours(f.as_of, now), limitHours);
  return {
    payee: f.payee,
    inbound_transfers: f.inbound.length,
    inbound_usd: Math.round(f.inbound.reduce((n, t) => n + t.usd, 0) * 1e6) / 1e6,
    distinct_payers: new Set(f.inbound.map((t) => t.counterparty)).size,
    first_seen: [f.inbound[0]?.time, f.outbound[0]?.time].filter(Boolean).sort()[0] ?? null,
    last_seen: [f.inbound.at(-1)?.time, f.outbound.at(-1)?.time].filter(Boolean).sort().at(-1) ?? null,
    source: "base-logs",
    as_of: f.as_of,
    in_census: census.payees.some((p) => p.payee === payee),
    band: cap.band,
    issued_band: r.band,
    score: r.score,
    vows: r.fired,
    deciding_vow: r.vow,
    band_cap: cap.band_cap,
    policy_version: POLICY_VERSION,
    scanned_days: f.window_days,
    window_limited_by: f.window_limited_by,
    prior_state: { nonce: f.prior_nonce, usdc: f.prior_usdc },
    basis: `USDC Transfer logs to and from the payee over ${f.window_days} days (blocks ${f.from_block}..${f.to_block}), ranked by the census policy unchanged; no Surf call, no wallet label`,
    fixture: SELF_COVERAGE_FILE,
  };
}

let cached: SelfCoverageFile | null | undefined;
/** The committed scan, or null when it has not been run. Read once. */
export function loadSelfCoverageFile(): SelfCoverageFile | null {
  if (cached !== undefined) return cached;
  const p = join(ROOT, SELF_COVERAGE_FILE);
  cached = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SelfCoverageFile) : null;
  return cached;
}

export function selfCoverageNow(census: Parameters<typeof selfCoverage>[1]): SelfCoverage | null {
  const f = loadSelfCoverageFile();
  return f ? selfCoverage(f, census, nowMs(), staleHours()) : null;
}
