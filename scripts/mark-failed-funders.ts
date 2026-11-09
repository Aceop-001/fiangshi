/**
 * Record the funder-outbound set refused before the funder path caught ScanRefused (2026-11-09), so it is never re-sent.
 * Usage: npx tsx scripts/mark-failed-funders.ts <checkpoint.json> "<reason>"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { hashOf } from "../src/core/canonical.js";

const [path, reason] = process.argv.slice(2) as [string, string];
const cp = JSON.parse(readFileSync(path, "utf8")) as {
  outbound_done: string[];
  excluded?: string[];
  payee_rows: Record<string, { first_inbound_from?: string }>;
  failed_sets?: string[];
  refusals?: unknown[];
};
const audited = cp.outbound_done.filter((p) => !(cp.excluded ?? []).includes(p));
const funders = [...new Set(audited.map((p) => String(cp.payee_rows[p]?.first_inbound_from ?? "")).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
const key = `payee-outbound:${hashOf([...funders].sort())}`;
cp.failed_sets = [...new Set([...(cp.failed_sets ?? []), key])];
cp.refusals = [...(cp.refusals ?? []), { at: new Date().toISOString(), template: "funder-outbound", payees: funders.length, message: reason }];
writeFileSync(path, JSON.stringify(cp, null, 1) + "\n");
console.log(`marked funder set (${funders.length} funders) as failed`);
