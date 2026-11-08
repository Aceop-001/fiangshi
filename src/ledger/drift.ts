/** Drift rules + policy decay. Pure. */

export interface Observation {
  url: string;
  payee: string;
  score: number;
  price: number | null;
  first_funder: string | null;
  dormancy_days: number | null;
  checked_at: string; // ISO
}

export type DriftEvent =
  | "band_cross_50"
  | "band_cross_80"
  | "payee_rotation"
  | "funder_change"
  | "price_drift"
  | "dormancy_reactivation";

export const PRICE_DRIFT = 0.1;
export const DORMANCY_DAYS = 60;

const crossed = (a: number, b: number, t: number) => (a >= t) !== (b >= t);

export function drift(prev: Observation, next: Observation): DriftEvent[] {
  const ev: DriftEvent[] = [];
  if (crossed(prev.score, next.score, 50)) ev.push("band_cross_50");
  if (crossed(prev.score, next.score, 80)) ev.push("band_cross_80");
  if (prev.url === next.url && prev.payee.toLowerCase() !== next.payee.toLowerCase()) ev.push("payee_rotation");
  if (prev.payee.toLowerCase() === next.payee.toLowerCase() && (prev.first_funder ?? "") !== (next.first_funder ?? ""))
    ev.push("funder_change");
  if (prev.price !== null && next.price !== null) {
    const base = Math.max(prev.price, 1e-9);
    if (Math.abs(next.price - prev.price) / base > PRICE_DRIFT) ev.push("price_drift");
  } else if (prev.price !== next.price) ev.push("price_drift");
  if (
    prev.dormancy_days !== null &&
    prev.dormancy_days >= DORMANCY_DAYS &&
    next.dormancy_days !== null &&
    next.dormancy_days < prev.dormancy_days
  )
    ev.push("dormancy_reactivation");
  return ev;
}

/** A verdict older than ttl is stale. A checked_at in the future is never trusted as fresh. */
export function isStale(checked_at: string, now: Date, ttlHours: number): boolean {
  const t = Date.parse(checked_at);
  if (!Number.isFinite(t)) return true;
  const ageH = (now.getTime() - t) / 3_600_000;
  return ageH < 0 || ageH > ttlHours;
}
