/** Build the static index: data/site/index.html (+ index.json). No JS in output. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dataDir, loadDotEnv } from "../src/config.js";
import { Receipt } from "../src/core/types.js";
import { indexHtml, indexRows } from "../src/indexpage.js";
import { readLedger } from "../src/ledger/store.js";
import { getSnapshot } from "../src/snapshot.js";

export async function buildIndex(outDir = join(dataDir(), "site")): Promise<{ path: string; rows: number }> {
  const snap = await getSnapshot();
  const ledger = readLedger().flatMap((r) => {
    const p = Receipt.safeParse(r);
    return p.success ? [p.data] : [];
  });
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "index.html");
  writeFileSync(path, indexHtml(snap, ledger));
  const rows = indexRows(snap, ledger);
  writeFileSync(join(outDir, "index.json"), JSON.stringify({ snapshot_id: snap.snapshot_id, payees: rows }, null, 2));
  return { path, rows: rows.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv();
  const r = await buildIndex();
  console.log(`index: ${r.rows} payees -> ${r.path}`);
}
