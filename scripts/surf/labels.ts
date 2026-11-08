/**
 * ONE budgeted wallet-labels-batch call (max 100 addresses) for payees + their first funders.
 * Usage: npx tsx scripts/surf/labels.ts <smoke-json> <out-json>
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../budget.js";

const SURF = process.env.SURF_BIN ?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".local", "bin", "surf.exe");
const [src, out] = process.argv.slice(2) as [string, string];
const rows = (JSON.parse(readFileSync(src, "utf8")) as { rows: { payee: string; first_inbound_from?: string }[] }).rows;
const addrs = [...new Set(rows.flatMap((r) => [r.payee, r.first_inbound_from].filter((x): x is string => !!x)))].slice(0, 100);

const t = Date.now();
const e = await guarded("surf", `wallet-labels-batch n=${addrs.length}`, async () => {
  const r = spawnSync(SURF, ["wallet-labels-batch", "--addresses", addrs.join(","), "--json"], { encoding: "utf8", timeout: 60_000 });
  const j = JSON.parse(r.stdout || "{}") as { error?: { code: string; message: string }; meta?: { credits_used?: number }; data?: unknown[] };
  if (j.error) throw new Error(`${j.error.code}: ${j.error.message}`);
  return { value: j, units: j.meta?.credits_used ?? null };
});
const ms = Date.now() - t;
writeFileSync(out, JSON.stringify({ addresses: addrs.length, ms, envelope: e }, null, 2) + "\n");
console.log(`meta ${JSON.stringify(e.meta)} ms=${ms} returned=${(e.data ?? []).length}/${addrs.length}`);
for (const d of (e.data ?? []) as { address: string; entity_name?: string; entity_type?: string; labels: { label: string; confidence?: number }[] }[])
  console.log(`${d.address} | ${d.entity_name ?? "-"} | ${d.entity_type ?? "-"} | ${d.labels.map((l) => `${l.label}(${l.confidence ?? "?"})`).join("; ")}`);
