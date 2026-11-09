/**
 * Record a set that failed (refused or killed) BEFORE the failed-set guard existed, so a resumed run never re-sends it.
 * Usage: npx tsx scripts/mark-failed-set.ts <checkpoint.json> <payee-inbound|payee-outbound> "<reason>"
 * The set = payees whose inbound is done but whose <template> is not (the pending part of the interrupted chunk).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { hashOf } from "../src/core/canonical.js";

const [path, template, reason] = process.argv.slice(2) as [string, "payee-inbound" | "payee-outbound", string];
const cp = JSON.parse(readFileSync(path, "utf8")) as { inbound_done: string[]; outbound_done: string[]; failed_sets?: string[]; refusals?: unknown[] };
const set = template === "payee-outbound" ? cp.inbound_done.filter((p) => !cp.outbound_done.includes(p)) : [];
if (!set.length) throw new Error("no pending set found");
const key = `${template}:${hashOf([...set].sort())}`;
cp.failed_sets = [...new Set([...(cp.failed_sets ?? []), key])];
cp.refusals = [...(cp.refusals ?? []), { at: new Date().toISOString(), template, payees: set.length, message: reason }];
writeFileSync(path, JSON.stringify(cp, null, 1) + "\n");
console.log(`marked ${template} set of ${set.length} payees as failed: ${key.slice(0, 40)}…`);
