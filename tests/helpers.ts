import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelAdvice } from "../src/core/decide.js";
import { validateModelOutput } from "../src/core/decide.js";
import type { PayeeSignals } from "../src/core/types.js";

export const tmp = () => mkdtempSync(join(tmpdir(), "fiangshi-"));

/** A clean, mature, CEX-funded, corroborated payee. Override fields per test. */
export function clean(over: Partial<PayeeSignals> = {}): PayeeSignals {
  return {
    payee: "0xpayee",
    wallet_age_hours: 5000,
    tx_count: 800,
    first_funder: "0xcex",
    funder_fanout: 0,
    distinct_payers: 120,
    repeat_payers: 30,
    total_received_usd: 9000,
    appears_in_other_listings: 1,
    token_concentration: 0.1,
    dormancy_days: 0,
    identity: { claims_org: "Acme", claims_product: "Acme API", corroborated: true },
    evidence: {
      wallet_age_hours: "first tx 5000h ago",
      tx_count: "800 tx",
      first_funder: "funded by 0xcex (exchange)",
      distinct_payers: "120 distinct payers",
      total_received_usd: "$9000 received",
      identity: "bio: Acme API",
    },
    ...over,
  };
}
export const LABELS = { "0xcex": "cex", "0xmixer": "mixer" } as const;

export function advice(raw: string, s: PayeeSignals): ModelAdvice {
  return { model: "test", validation: validateModelOutput(raw, s), attempts: 1 };
}
export const allowRaw = (s: PayeeSignals) =>
  JSON.stringify({ band: "ALLOW", citations: [{ signal: "wallet_age_hours", quote: s.evidence.wallet_age_hours ?? "x" }] });
export const unreachable: ModelAdvice = { model: "none", validation: null, attempts: 1 };
