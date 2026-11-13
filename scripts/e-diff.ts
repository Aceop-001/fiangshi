/**
 * E v1 -> v2 band diff on cached data only (0 credits).
 *   1. synthetic fixture snapshot (31 payees)
 *   2. real cached Surf rows (fixtures/surf/smoke-12payees.json) — reports what can and cannot be derived
 * Usage: npx tsx scripts/e-diff.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { funderLabelsFromSurf, signalsFromSurf, type SurfPayeeRow, type SurfWalletLabel } from "../src/adapters/surf.js";
import { diffE } from "../src/policy.js";
import { buildSnapshot } from "../src/snapshot.js";

import { ROOT } from "../src/config.js";
process.env.SNAPSHOT_SOURCE = "fixture";

const { snapshot } = await buildSnapshot();
const priceOf = new Map(snapshot.payload.endpoints.map((e) => [e.payee, e.price]));
const syn = diffE(snapshot.payload.payees.map((s) => ({ s, price: priceOf.get(s.payee) ?? 0.05 })), snapshot.payload.funder_labels);
console.log(`synthetic fixtures: n=${syn.n} changed=${syn.changed.length} v1=${JSON.stringify(syn.v1)} v2=${JSON.stringify(syn.v2)}`);
for (const c of syn.changed) console.log(`  ${c.payee.slice(0, 10)} ${c.v1}(${c.v1Score}) -> ${c.v2}(${c.v2Score})`);

const rows = (JSON.parse(readFileSync(join(ROOT, "fixtures/surf/smoke-12payees.json"), "utf8")) as { rows: SurfPayeeRow[] }).rows;
const labels = (JSON.parse(readFileSync(join(ROOT, "fixtures/surf/labels-12payees.json"), "utf8")) as { envelope: { data: SurfWalletLabel[] } }).envelope.data;
const { labels: fl, tokenContracts } = funderLabelsFromSurf(labels);
const now = Math.floor(Date.parse("2026-11-08T16:24:30Z") / 1000);
const real = rows.map((r) => ({ s: signalsFromSurf(r, { now, windowStart: now - 365 * 86400, tokenContracts }), price: 0.005 }));
const haveTop = real.filter((x) => x.s.top_payer_share !== null).length;
const haveTok = real.filter((x) => x.s.token_asset_share !== null).length;
const rd = diffE(real, fl);
console.log(`real cached (12 payees): top_payer_share present ${haveTop}/12, token_asset_share present ${haveTok}/12 -> changed=${rd.changed.length} v1=${JSON.stringify(rd.v1)} v2=${JSON.stringify(rd.v2)}`);
