/**
 * Write the refreshed census as a dated snapshot (0 credits): data/snapshot-<YYYY-MM-DD>.json, never overwritten
 * (a second run the same day writes -attempt2). One record per payee with its own as_of; snapshot_id = sha256(payload).
 *
 *   npx tsx scripts/census-snapshot.ts
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { hashOf } from "../src/core/canonical.js";
import { POLICY_VERSION } from "../src/core/cap.js";
import { loadCensus } from "../src/census.js";
import { writeNoClobber } from "../src/fsutil.js";

const c = loadCensus();
const records = c.payees
  .map((p) => ({ chain: p.chain, payee: p.payee, url: p.url, issued_band: p.issued_band, score: p.score, vows: p.vows, first_funder: p.first_funder, as_of: p.as_of, receipt_id: p.receipt_id }))
  .sort((a, b) => a.payee.localeCompare(b.payee));
const payload = { census_at: c.at, window_days: c.window_days, catalog_payees: c.catalog_payees, policy_version: POLICY_VERSION, oldest_as_of: c.oldest_as_of, newest_as_of: c.newest_as_of, issued_bands: c.issued_bands, records };
const snapshot_id = hashOf(payload);
mkdirSync(join(ROOT, "data"), { recursive: true });
const out = writeNoClobber(join(ROOT, "data", `snapshot-${c.at.slice(0, 10)}.json`), JSON.stringify({ snapshot_id, ...payload }, null, 1) + "\n");
console.log(`${records.length} records, snapshot_id ${snapshot_id} -> ${out}`);
