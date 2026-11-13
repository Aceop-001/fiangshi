/**
 * Receipts that outlive the server. A receipt carries everything needed to verify its own hash and re-derive its band,
 * so the caller keeps the payload, and any Fiangshi server (or anyone with the code) can check it later, even after the
 * server that issued it has forgotten it. What a payload alone cannot prove is the link to the receipt before it: that
 * needs the ledger that held the predecessor. Verification says which of the two it could check (`chain_linkage`).
 *
 *   ?receipt=<base64url of the receipt JSON>
 *   ?receipt=gz:<base64url of the gzipped receipt JSON>     (shorter, for long receipts)
 */
import { gunzipSync, gzipSync } from "node:zlib";

/** Largest decoded receipt accepted (bytes). A real receipt is a few KB. */
export const MAX_RECEIPT_BYTES = 16 * 1024;

export const encodeReceipt = (r: unknown): string => Buffer.from(JSON.stringify(r), "utf8").toString("base64url");
export const encodeReceiptGz = (r: unknown): string => `gz:${gzipSync(Buffer.from(JSON.stringify(r), "utf8")).toString("base64url")}`;

/** The absolute URL that verifies this receipt from its payload alone. */
export const receiptVerifyUrl = (base: string, r: unknown): string => `${base}/v1/verify?receipt=${encodeReceipt(r)}`;

export type Decoded = { ok: true; obj: unknown } | { ok: false; error: string };

export function decodeReceiptParam(raw: string): Decoded {
  let bytes: Buffer;
  try {
    if (raw.startsWith("gz:")) {
      // maxOutputLength stops a small compressed payload from expanding without bound
      bytes = gunzipSync(Buffer.from(raw.slice(3), "base64url"), { maxOutputLength: MAX_RECEIPT_BYTES + 1 });
    } else {
      if (raw.length > Math.ceil((MAX_RECEIPT_BYTES * 4) / 3) + 4) return { ok: false, error: `receipt is larger than ${MAX_RECEIPT_BYTES} bytes` };
      bytes = Buffer.from(raw, "base64url");
    }
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|too large/i.test((e as Error).message)) return { ok: false, error: `receipt is larger than ${MAX_RECEIPT_BYTES} bytes` };
    return { ok: false, error: "receipt is not valid gzip" };
  }
  if (bytes.length > MAX_RECEIPT_BYTES) return { ok: false, error: `receipt is larger than ${MAX_RECEIPT_BYTES} bytes` };
  try {
    return { ok: true, obj: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { ok: false, error: "receipt is not base64url JSON" };
  }
}
