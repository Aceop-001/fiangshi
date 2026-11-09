/**
 * Snapshot: enumerate endpoints, dedupe payees, ONE batched data pass, recompute kinship fanout locally,
 * snapshot_id = sha256(canonical(payload)). built_at is outside the hash so rebuilds are stable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir, snapshotSource } from "./config.js";
import { loadFixtures402, parse402 } from "./adapters/probe.js";
import { fetchSignalsBatch, type FundersFile } from "./adapters/surf.js";
import { canonical, hashOf } from "./core/canonical.js";
import { sanitize } from "./core/score.js";
import { PayeeSignals, Snapshot, kinshipExempt, type FunderLabel, type SnapshotPayload, type Terms } from "./core/types.js";

export const snapshotPath = () => join(dataDir(), "snapshot.json");

/** Funder ancestry up to 2 hops, CEX nodes excluded (an exchange funding many sellers is not kinship). */
function ancestors(funder: string | null, funders: FundersFile): string[] {
  if (!funder) return [];
  const out = [funder];
  const parent = funders.edges[funder];
  if (parent) out.push(parent.toLowerCase());
  return out.filter((a) => !kinshipExempt(funders.labels[a]));
}

/** For each payee: number of OTHER catalog payees sharing a non-CEX funder within <=2 hops. */
export function computeFanout(payees: PayeeSignals[], funders: FundersFile): Map<string, number> {
  const byAncestor = new Map<string, Set<string>>();
  const anc = new Map<string, string[]>();
  for (const p of payees) {
    const a = ancestors(p.first_funder, funders);
    anc.set(p.payee, a);
    for (const x of a) (byAncestor.get(x) ?? byAncestor.set(x, new Set()).get(x)!).add(p.payee);
  }
  const out = new Map<string, number>();
  for (const p of payees) {
    const kin = new Set<string>();
    for (const x of anc.get(p.payee) ?? []) for (const q of byAncestor.get(x) ?? []) if (q !== p.payee) kin.add(q);
    out.set(p.payee, kin.size);
  }
  return out;
}

/** Validate + sanitize + dedupe rows. Invalid rows are rejected (their payees then fall to silence => REVIEW). */
export function normalizePayees(rows: unknown[]): { payees: PayeeSignals[]; rejected: number } {
  const byPayee = new Map<string, PayeeSignals>();
  let rejected = 0;
  const valid: PayeeSignals[] = [];
  for (const r of rows) {
    const p = PayeeSignals.safeParse(r);
    if (p.success) valid.push(sanitize(p.data));
    else rejected++;
  }
  // deterministic: sort by payee then canonical form; first wins on duplicates
  valid.sort((a, b) => (a.payee === b.payee ? canonical(a).localeCompare(canonical(b)) : a.payee.localeCompare(b.payee)));
  for (const p of valid) if (!byPayee.has(p.payee)) byPayee.set(p.payee, p);
  return { payees: [...byPayee.values()], rejected };
}

export async function buildSnapshot(): Promise<{ snapshot: Snapshot; calls: number; rejected: number }> {
  const endpoints: Terms[] = [];
  const seen = new Set<string>();
  for (const raw of loadFixtures402()) {
    const r = parse402(raw);
    if (r.ok && !seen.has(r.terms.url)) {
      seen.add(r.terms.url);
      endpoints.push(r.terms);
    }
  }
  endpoints.sort((a, b) => a.url.localeCompare(b.url));
  const payeeSet = [...new Set(endpoints.map((e) => e.payee))].sort();
  const batch = await fetchSignalsBatch(payeeSet);
  const { payees, rejected } = normalizePayees(batch.rows);
  const funders: FundersFile = {
    labels: Object.fromEntries(Object.entries(batch.funders.labels).map(([k, v]) => [k.toLowerCase(), v])) as Record<string, FunderLabel>,
    edges: Object.fromEntries(Object.entries(batch.funders.edges).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])),
  };
  const fan = computeFanout(payees, funders);
  const withFan = payees.map((p) => (p.first_funder === null ? p : { ...p, funder_fanout: fan.get(p.payee) ?? 0 }));
  const payload: SnapshotPayload = { source: snapshotSource(), endpoints, payees: withFan, funder_labels: funders.labels };
  const snapshot: Snapshot = { snapshot_id: hashOf(payload), built_at: new Date().toISOString(), payload };
  return { snapshot, calls: batch.calls, rejected };
}

export function writeSnapshot(s: Snapshot, path = snapshotPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s, null, 2));
}

export function loadSnapshot(path = snapshotPath()): Snapshot | null {
  if (!existsSync(path)) return null;
  const s = Snapshot.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!s.success || hashOf(s.data.payload) !== s.data.snapshot_id) return null; // tampered or stale schema
  return s.data;
}

/** Cached snapshot if present; otherwise build (fixture mode needs no network). */
export async function getSnapshot(): Promise<Snapshot> {
  return loadSnapshot() ?? (await buildSnapshot()).snapshot;
}
