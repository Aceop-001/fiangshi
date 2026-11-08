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
import { FunderLabel } from "../core/types.js";

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
    else if (t === "mixer") labels[a] = "mixer";
    else if (t === "stablecoin" || t === "token") tokenContracts.push(a);
  }
  for (const [addr, n] of Object.entries(outboundReceivers)) {
    const a = addr.toLowerCase();
    if (!labels[a] && !tokenContracts.includes(a) && n >= EXCHANGE_FANOUT_HEURISTIC) labels[a] = "cex";
  }
  return { labels, tokenContracts };
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
