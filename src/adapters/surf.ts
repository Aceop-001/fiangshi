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
