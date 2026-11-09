/**
 * 0-credit simulation: what identity v3 (as specified 2026-11-09) does to the 800-payee census bands.
 *   0 claims -> 0 · self-claim only -> 0.25 · self-claim corroborated by URL host/path -> 0.5 · + label agreement -> 0.75
 * Census claims come from the catalog serviceName only (Dolphin is not run in the census). Prints band counts and
 * what happens to the current ALLOWs. Usage: npx tsx scripts/sim-identity-v3.ts
 */
import { readFileSync } from "node:fs";
import { scoredSet, setWindowDays, type Sample } from "./audit.js";
import { WEIGHTS } from "../src/core/score.js";
import { IDENTITY_AGE_H } from "../src/core/vows.js";
import { bandForScore, minBand, type Band } from "../src/core/types.js";

setWindowDays(90);
const sample = JSON.parse(readFileSync("fixtures/audit/sample-census.json", "utf8")) as Sample;
const cp = JSON.parse(readFileSync("fixtures/audit/checkpoint-sample-census-w90.json", "utf8"));
const ranAt = (cp.calls as { label: string; at: string }[]).filter((c) => c.label.startsWith("onchain-sql")).map((c) => c.at).sort().pop()!;
const { scored } = scoredSet(sample, cp, ranAt);
const meta = new Map(sample.payees.map((p) => [p.payee, p]));
const tok = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3);

const count = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<Band, number>;
const allowFate: string[] = [];
for (const e of scored) {
  const m = meta.get(e.s.payee)!;
  const claim = m.service?.trim() || null;
  let host = "", path = "";
  try { const u = new URL(m.example_url); host = u.host.toLowerCase(); path = u.pathname.toLowerCase(); } catch { /* none */ }
  const corroborated = claim ? tok(claim).some((w) => host.includes(w) || path.includes(w)) : false;
  const labelAgrees = !!e.s.identity.claims_org; // census: identity set only from a Surf entity_name label
  const anchored = process.argv.includes("--anchored"); // neutral-anchored variant: none 0.5, self-claim 0.5, host-corroborated 0.75, + label 1.0
  const iNew = anchored
    ? (!claim ? (labelAgrees ? 0.75 : 0.5) : corroborated ? (labelAgrees ? 1 : 0.75) : 0.5)
    : !claim ? (labelAgrees ? 0.5 : 0) : corroborated ? (labelAgrees ? 0.75 : 0.5) : 0.25;
  const iOld = e.s.identity.corroborated && e.s.identity.claims_org ? 1 : e.s.identity.claims_org ? 0 : 0.5;
  const sc = Math.round((e.r.score - WEIGHTS.I * iOld + WEIGHTS.I * iNew) * 100) / 100;
  const silence = e.r.fired.includes("silence");
  const identityVow = !!claim && !corroborated && e.s.wallet_age_hours !== null && e.s.wallet_age_hours < IDENTITY_AGE_H;
  const other = e.r.fired.filter((v) => v !== "identity" && v !== "silence");
  const vowBand: Band = other.includes("null_payee") || other.includes("kinship") || other.includes("age") || identityVow ? "BLOCK" : other.includes("history") ? "REVIEW" : "ALLOW";
  const band = minBand(silence ? "REVIEW" : bandForScore(sc), vowBand);
  count[band]++;
  if (e.r.band === "ALLOW") allowFate.push(`${e.s.payee.slice(0, 10)} ${m.example_url.replace(/^https?:\/\//, "").slice(0, 30)} claim=${claim ?? "none"} corroborated=${corroborated} ${e.r.score} -> ${sc} ${band}`);
}
console.log(`identity v3${process.argv.includes("--anchored") ? " (anchored at 0.5)" : " (as specified)"} on the census: ALLOW ${count.ALLOW} / REVIEW ${count.REVIEW} / BLOCK ${count.BLOCK}  (now: 15 / 492 / 293)`);
console.log(`fate of today's 15 ALLOWs:\n  ${allowFate.join("\n  ")}`);
