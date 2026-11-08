import { createHash } from "node:crypto";

/** Deterministic JSON: sorted object keys, no whitespace, undefined dropped. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortDeep(x);
    }
    return out;
  }
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error("canonical: non-finite number");
  return v;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function hashOf(value: unknown): string {
  return sha256(canonical(value));
}
