/**
 * Surf adapter: on-chain facts for the WHOLE deduped payee set in one batched pass.
 * Fixture mode replays fixtures/payees.json + fixtures/funders.json.
 *
 * TODO(api-wiring §A): live mode. Discover operations with `surf list-operations`, `surf --help`,
 * `surf onchain-sql --help` and copy names verbatim. ONE query per METRIC over the full payee list,
 * each through guarded("surf", ...). No per-payee loop. Not implemented until discovery is done.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { fixturesDir, isOffline, snapshotSource } from "../config.js";
import { FunderLabel, type PayeeSignals } from "../core/types.js";

/** One batched query each. snapshot rebuild must stay <= 5 data calls. */
export const METRICS = ["wallet_facts", "funding", "payments", "holdings", "identity"] as const;

export const FundersFile = z.object({
  labels: z.record(z.string(), FunderLabel),
  edges: z.record(z.string(), z.string()), // funder -> its own funder (second hop)
});
export type FundersFile = z.infer<typeof FundersFile>;

/** One row of `surf wallet-labels-batch --json` data[] (field names verbatim from `--help`). */
export interface SurfWalletLabel {
  address: string;
  entity_name?: string;
  entity_type?: string;
  labels: { label: string; confidence?: number }[];
}

/** Unlabelled funders with at least this many distinct outbound receivers in the window are treated as exchange-like. */
export const EXCHANGE_FANOUT_HEURISTIC = 500;
/** Surf entity_type values treated as relayer infrastructure (observed 2026-11-09: "bridge", "dex-aggregator"). */
export const INFRA_TYPES: readonly string[] = ["bridge", "dex-aggregator", "relayer", "facilitator"];

/**
 * Map Surf labels to funder labels used by provenance + the kinship vow's exclusion.
 * entity_type "cex" -> cex. Token contracts (entity_type "stablecoin" / "token") are not funders:
 * they are returned separately so the snapshot can treat that first_funder as missing.
 * Optional fanout map: unlabelled address with >= EXCHANGE_FANOUT_HEURISTIC distinct receivers -> cex.
 */
export function funderLabelsFromSurf(
  rows: SurfWalletLabel[],
  outboundReceivers: Record<string, number> = {},
): { labels: Record<string, FunderLabel>; tokenContracts: string[] } {
  const labels: Record<string, FunderLabel> = {};
  const tokenContracts: string[] = [];
  for (const r of rows) {
    const a = r.address.toLowerCase();
    const t = (r.entity_type ?? "").toLowerCase();
    if (t === "cex") labels[a] = "cex";
    else if (INFRA_TYPES.includes(t)) labels[a] = "infra";
    else if (t === "mixer") labels[a] = "mixer";
    else if (t === "stablecoin" || t === "token") tokenContracts.push(a);
  }
  for (const [addr, n] of Object.entries(outboundReceivers)) {
    const a = addr.toLowerCase();
    if (!labels[a] && !tokenContracts.includes(a) && n >= EXCHANGE_FANOUT_HEURISTIC) labels[a] = "cex";
  }
  return { labels, tokenContracts };
}

/** Merged row from scripts/surf/payee-inbound.sql + payee-outbound.sql (column names verbatim). */
export interface SurfPayeeRow {
  payee: string;
  first_inbound_at?: number;
  last_inbound_at?: number;
  inbound_count?: number;
  distinct_inbound_senders?: number;
  first_inbound_from?: string;
  inbound_usd?: number | null;
  top_token_share?: number | null;
  top_payer_share?: number | null;
  first_outbound_at?: number;
  last_outbound_at?: number;
  outbound_count?: number;
  distinct_outbound_receivers?: number;
}

const iso = (t: number) => new Date(t * 1000).toISOString();

/**
 * Surf rows -> PayeeSignals. Pure: `now` (unix s) and `windowStart` (unix s) are inputs.
 * A payee with no rows in the window gets all-missing activity (silence vow -> REVIEW).
 * first_funder that is a token contract is treated as missing. funder_fanout is computed later, catalog-wide.
 */
export function signalsFromSurf(
  r: SurfPayeeRow,
  ctx: { now: number; windowStart: number; tokenContracts: string[]; identity?: { claims_org: string | null; claims_product?: string | null; corroborated: boolean | null; sources?: string[] } },
): PayeeSignals {
  const times = [r.first_inbound_at, r.first_outbound_at].filter((x): x is number => typeof x === "number" && x > 0);
  const lasts = [r.last_inbound_at, r.last_outbound_at].filter((x): x is number => typeof x === "number" && x > 0);
  const first = times.length ? Math.min(...times) : null;
  const last = lasts.length ? Math.max(...lasts) : null;
  const inbound = r.inbound_count ?? (first !== null ? 0 : null);
  const outbound = r.outbound_count ?? (first !== null ? 0 : null);
  const distinct = r.distinct_inbound_senders ?? (first !== null ? 0 : null);
  const funderRaw = r.first_inbound_from?.toLowerCase() ?? null;
  const funder = funderRaw && !ctx.tokenContracts.includes(funderRaw) ? funderRaw : null;
  const evidence: Record<string, string> = {};
  if (first !== null) evidence.wallet_age_hours = `first transfer ${iso(first)}${first <= ctx.windowStart + 86_400 ? " (window start: age is a lower bound)" : ""} (surf agent.base_transfers)`;
  if (inbound !== null && outbound !== null) evidence.tx_count = `${inbound} inbound + ${outbound} outbound transfers in window`;
  if (funder) evidence.first_funder = `first inbound transfer from ${funder}`;
  if (distinct !== null) evidence.distinct_payers = `${distinct} distinct inbound senders, ${inbound} inbound transfers`;
  if (typeof r.inbound_usd === "number") evidence.total_received_usd = `$${r.inbound_usd.toFixed(2)} inbound (USD pricing lags ~3d)`;
  if (ctx.identity?.claims_org) evidence.identity = `surf label: ${ctx.identity.claims_org}`;
  return {
    payee: r.payee.toLowerCase(),
    wallet_age_hours: first !== null ? Math.max(0, (ctx.now - first) / 3600) : null,
    tx_count: inbound !== null && outbound !== null ? inbound + outbound : null,
    first_funder: funder,
    funder_fanout: funder ? 0 : null, // recomputed over the catalog sample
    distinct_payers: distinct,
    repeat_payers: inbound !== null && distinct !== null ? Math.max(0, inbound - distinct) : null,
    total_received_usd: typeof r.inbound_usd === "number" ? r.inbound_usd : first !== null ? 0 : null,
    appears_in_other_listings: null,
    token_asset_share: typeof r.top_token_share === "number" ? r.top_token_share : null,
    top_payer_share: typeof r.top_payer_share === "number" ? r.top_payer_share : null,
    dormancy_days: last !== null ? Math.max(0, (ctx.now - last) / 86_400) : null,
    identity: { claims_org: ctx.identity?.claims_org ?? null, claims_product: ctx.identity?.claims_product ?? null, corroborated: ctx.identity?.corroborated ?? null, ...(ctx.identity?.sources ? { sources: ctx.identity.sources } : {}) },
    evidence,
  };
}

export interface BatchResult {
  rows: unknown[]; // validated later, per payee
  funders: FundersFile;
  calls: number;
}

export async function fetchSignalsBatch(payees: string[]): Promise<BatchResult> {
  if (isOffline() || snapshotSource() === "fixture") {
    const rows = JSON.parse(readFileSync(join(fixturesDir(), "payees.json"), "utf8")) as unknown[];
    const funders = FundersFile.parse(JSON.parse(readFileSync(join(fixturesDir(), "funders.json"), "utf8")));
    return { rows, funders, calls: 0 };
  }
  void payees;
  throw new Error("surf live mode not wired yet: run discovery per docs/API_WIRING.md §A (no command names are guessed)");
}
