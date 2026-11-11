/**
 * The real cold-check fetcher: two synchronous Surf SQL calls (payee-inbound, payee-outbound) for one address,
 * each through the budget guard (logged in artifacts/costs.md). Kept apart from src/cold.ts so tests never load the CLI.
 */
import { surfBalance } from "../scripts/audit.js";
import { runSync } from "../scripts/surf/payee-facts.js";
import type { SurfPayeeRow } from "./adapters/surf.js";
import type { ColdFetcher } from "./cold.js";

export const surfColdFetcher: ColdFetcher = {
  balance: () => surfBalance(),
  async fetch(payee: string, days: number) {
    const q = await runSync([payee], days, ["payee-inbound", "payee-outbound"]);
    const bad = q.calls.find((c) => c.envelope?.error);
    if (bad) throw new Error(`surf: ${bad.envelope.error?.code ?? "error"}: ${bad.envelope.error?.message ?? ""}`);
    const row = (q.rows.find((r) => String(r.payee).toLowerCase() === payee) ?? { payee }) as unknown as SurfPayeeRow;
    return { row, calls: q.calls.length };
  },
};
