/**
 * FROZEN DATA CONTRACTS. Change only with a test proving the change.
 * Names copied verbatim from CLAUDE.md "DATA CONTRACTS".
 */
import { z } from "zod";

export const BANDS = ["BLOCK", "REVIEW", "ALLOW"] as const; // ordered: lowest -> highest
export const Band = z.enum(BANDS);
export type Band = z.infer<typeof Band>;

export const VOW_NAMES = ["null_payee", "age", "kinship", "history", "identity", "silence"] as const; // precedence order (null_payee added 2026-11-09)
export const VowName = z.enum(VOW_NAMES);
export type VowName = z.infer<typeof VowName>;

const hex = z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex");

/** Payment terms parsed from an unpaid 402 response. price is USD; null when it cannot be derived. */
export const Terms = z.object({
  url: z.string().min(1),
  price: z.number().nonnegative().nullable(),
  asset: z.string().min(1),
  network: z.string().min(1),
  payee: z.string().min(1),
  terms_hash: hex,
});
export type Terms = z.infer<typeof Terms>;

export const Identity = z.object({
  claims_org: z.string().nullable(),
  claims_product: z.string().nullable(),
  corroborated: z.boolean().nullable(),
  /** identity v3: independent corroboration sources (host, path, catalog, label, model_agreement). */
  sources: z.array(z.string()).optional(),
  /** a Surf label names a DIFFERENT entity than the claim (V5 BLOCK). */
  contradicted: z.boolean().optional(),
});
export type Identity = z.infer<typeof Identity>;

/**
 * On-chain + social facts about a payee. Every metric is nullable: null means "missing",
 * which the silence vow turns into REVIEW. Keys are all required (presence is the contract).
 */
export const PayeeSignals = z.object({
  payee: z.string().min(1),
  wallet_age_hours: z.number().nullable(),
  tx_count: z.number().nullable(),
  first_funder: z.string().nullable(),
  funder_fanout: z.number().nullable(),
  distinct_payers: z.number().nullable(),
  repeat_payers: z.number().nullable(),
  total_received_usd: z.number().nullable(),
  appears_in_other_listings: z.number().nullable(),
  token_asset_share: z.number().nullable(), // informational only (v1 E input); x402 sellers are ~1.0 by design
  top_payer_share: z.number().nullable(), // largest sender share of inbound USD (E v2 input)
  dormancy_days: z.number().nullable(),
  identity: Identity,
  evidence: z.record(z.string(), z.string()),
});
export type PayeeSignals = z.infer<typeof PayeeSignals>;

export const Citation = z.object({ signal: z.string(), quote: z.string() });
export type Citation = z.infer<typeof Citation>;

export const Verdict = z.object({
  band: Band,
  score: z.number().min(0).max(100),
  vow_fired: VowName.optional(),
  citations: z.array(Citation),
  degraded: z.boolean(),
  model: z.string(),
});
export type Verdict = z.infer<typeof Verdict>;

export const Settlement = z.union([z.literal("dry-run"), z.string().regex(/^kite:.+$/)]);

export const Receipt = z.object({
  payee: z.string(),
  url: z.string(),
  terms_hash: hex,
  price: z.number().nullable(),
  band: Band,
  score: z.number(),
  vow_fired: VowName.nullable(),
  evidence: z.array(Citation),
  model: z.object({ verdict: Band.nullable(), extractor: z.string(), degraded: z.boolean() }),
  snapshot_id: hex,
  checked_at: z.string(),
  prev_hash: z.union([hex, z.literal("genesis")]),
  receipt_hash: hex,
  settlement: Settlement,
  /** optional enrichment (Dolphin identity extraction). "incomplete" never changes the band; the reason says why. */
  enrichment: z.object({ status: z.enum(["complete", "incomplete", "skipped"]), reason: z.string().nullable() }).optional(),
  /** CAIP-2 chain of the payee (2026-11-11). Base only; stamped so a future chain can never collide with a Base address. */
  chain: z.literal("eip155:8453").optional(),
  /** Ledger epoch (2026-11-13): set on live-ledger receipts; continuity is only checkable within one epoch. */
  chain_id: hex.optional(),
});
export type Receipt = z.infer<typeof Receipt>;

/** Raw recorded HTTP response (fixtures/402/*.json). */
export const RawResponse = z.object({
  url: z.string(),
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});
export type RawResponse = z.infer<typeof RawResponse>;

/** cex = exchange hot wallet; infra = bridge / DEX-aggregator / relayer (2026-11-09); mixer = mixer output. */
export const FunderLabel = z.enum(["cex", "mixer", "infra"]);
/** Funders whose many-to-one funding is normal infrastructure, not an operator ring: excluded from kinship. */
export const kinshipExempt = (l: string | undefined) => l === "cex" || l === "infra";
export type FunderLabel = z.infer<typeof FunderLabel>;

/** data/snapshot.json. snapshot_id = sha256(canonical(payload)). built_at is outside the hash. */
export const SnapshotPayload = z.object({
  source: z.enum(["fixture", "live"]),
  endpoints: z.array(Terms),
  payees: z.array(PayeeSignals),
  funder_labels: z.record(z.string(), FunderLabel),
});
export type SnapshotPayload = z.infer<typeof SnapshotPayload>;

export const Snapshot = z.object({
  snapshot_id: hex,
  built_at: z.string(),
  payload: SnapshotPayload,
});
export type Snapshot = z.infer<typeof Snapshot>;

/** Raw model output before validation (what SERV is asked to return). */
export const ModelOutput = z.object({
  band: Band,
  citations: z.array(Citation),
  rationale: z.string().optional(),
});
export type ModelOutput = z.infer<typeof ModelOutput>;

/** Signals whose absence fires the silence vow. */
export const REQUIRED_SIGNALS = [
  "wallet_age_hours",
  "tx_count",
  "first_funder",
  "funder_fanout",
  "distinct_payers",
  "total_received_usd",
  "top_payer_share",
] as const satisfies readonly (keyof PayeeSignals)[];

/** Evidence keys counted by corroboration (C). */
export const EVIDENCE_FIELDS = [
  "wallet_age_hours",
  "tx_count",
  "first_funder",
  "distinct_payers",
  "total_received_usd",
  "identity",
] as const;

export function bandRank(b: Band): number {
  return BANDS.indexOf(b);
}
export function minBand(...bs: Band[]): Band {
  return bs.reduce((a, b) => (bandRank(b) < bandRank(a) ? b : a), "ALLOW" as Band);
}
export function bandForScore(score: number): Band {
  if (score >= 80) return "ALLOW";
  if (score >= 50) return "REVIEW";
  return "BLOCK";
}
