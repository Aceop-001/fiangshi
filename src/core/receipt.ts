/** Receipts: canonical JSON, sha256, prev_hash chain. Pure. */
import { hashOf } from "./canonical.js";
import { Receipt } from "./types.js";

export type ReceiptBody = Omit<Receipt, "receipt_hash" | "prev_hash">;

export function sealReceipt(body: ReceiptBody, prev_hash: string): Receipt {
  const unsealed = { ...body, prev_hash };
  return { ...unsealed, receipt_hash: hashOf(unsealed) } as Receipt;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

/** Recompute the hash over every field except receipt_hash. Any tampered field breaks it. */
export function verifyReceipt(r: unknown): VerifyResult {
  const parsed = Receipt.safeParse(r);
  if (!parsed.success) return { ok: false, errors: ["schema: " + parsed.error.issues.map((i) => i.path.join(".")).join(",")] };
  // Hash the raw object (minus receipt_hash) so unknown injected fields also break verification.
  const { receipt_hash, ...rest } = r as Record<string, unknown>;
  const expected = hashOf(rest);
  return expected === receipt_hash ? { ok: true, errors: [] } : { ok: false, errors: [`hash mismatch: expected ${expected}`] };
}

export function verifyChain(receipts: unknown[]): VerifyResult {
  const errors: string[] = [];
  let prev = "genesis";
  receipts.forEach((r, i) => {
    const one = verifyReceipt(r);
    if (!one.ok) errors.push(`#${i}: ${one.errors.join("; ")}`);
    const rec = r as Partial<Receipt>;
    if (rec.prev_hash !== prev) errors.push(`#${i}: prev_hash ${rec.prev_hash} != ${prev}`);
    prev = String(rec.receipt_hash);
  });
  return { ok: errors.length === 0, errors };
}
