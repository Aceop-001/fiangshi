/**
 * x402 seller side (Kite Agent Passport). Fiangshi never holds funds, signs, or sends transactions:
 * the facilitator settles; we only verify and record.
 *
 * TODO(api-wiring §D, phase 8): read docs.gokite.ai/passport/seller + agentpassport.ai/quickstart,
 * then implement 402 -> verify X-Payment -> settle via KITE_FACILITATOR_URL -> deliver.
 * Until then every receipt is settlement:"dry-run".
 */
export type SettlementTag = "dry-run" | `kite:${string}`;

export function currentSettlement(): SettlementTag {
  return "dry-run";
}
