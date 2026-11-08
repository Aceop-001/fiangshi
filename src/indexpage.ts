/** Static index page from snapshot + ledger. Zero JavaScript. Pure (string in, string out). */
import { components, score } from "./core/score.js";
import { decidingVow, evaluateVows } from "./core/vows.js";
import { bandForScore, minBand, type Band, type Receipt, type Snapshot } from "./core/types.js";

export interface IndexRow {
  payee: string;
  score: number;
  band: Band; // deterministic policy band (score + vows, no model)
  vow: string | null;
  cluster: string;
  last_checked: string | null;
  last_band: Band | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

export function indexRows(snap: Snapshot, ledger: Receipt[]): IndexRow[] {
  const labels = snap.payload.funder_labels;
  const priceOf = new Map(snap.payload.endpoints.map((e) => [e.payee, e.price]));
  const last = new Map<string, Receipt>();
  for (const r of ledger) if (r.snapshot_id === snap.snapshot_id) last.set(r.payee, r);
  return snap.payload.payees
    .map((s) => {
      const sc = score(components(s, labels));
      const rows = evaluateVows({ signals: s, price: priceOf.get(s.payee) ?? 0, funder_labels: labels });
      const silence = rows.find((r) => r.vow === "silence")!.fired;
      const dv = decidingVow(rows);
      const band = minBand(silence ? "REVIEW" : bandForScore(sc), dv?.band ?? "ALLOW");
      const f = s.first_funder;
      const cluster = f === null ? "unknown funder" : labels[f] ? `${labels[f]}:${short(f)}` : `funder:${short(f)}`;
      const lr = last.get(s.payee);
      return { payee: s.payee, score: sc, band, vow: dv?.vow ?? null, cluster, last_checked: lr?.checked_at ?? null, last_band: lr?.band ?? null };
    })
    .sort((a, b) => b.score - a.score || a.payee.localeCompare(b.payee));
}

export function indexHtml(snap: Snapshot, ledger: Receipt[]): string {
  const rows = indexRows(snap, ledger);
  const clusters = new Map<string, IndexRow[]>();
  for (const r of rows) (clusters.get(r.cluster) ?? clusters.set(r.cluster, []).get(r.cluster)!).push(r);
  const counts = { ALLOW: 0, REVIEW: 0, BLOCK: 0 } as Record<Band, number>;
  rows.forEach((r) => counts[r.band]++);
  const tr = (r: IndexRow) =>
    `<tr class="${r.band}"><td><code>${esc(r.payee)}</code></td><td>${r.score.toFixed(2)}</td><td>${r.band}</td><td>${esc(r.vow ?? "")}</td><td>${esc(r.last_band ?? "")}</td><td>${esc(r.last_checked ?? "")}</td></tr>`;
  const head = `<tr><th>payee</th><th>score</th><th>policy band</th><th>vow</th><th>last receipt</th><th>checked at</th></tr>`;
  const clusterHtml = [...clusters.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([c, rs]) => `<section><h3>${esc(c)} <small>(${rs.length})</small></h3><table>${head}${rs.map(tr).join("")}</table></section>`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fiangshi Index</title>
<style>
:root{--bg:#fbfbf8;--fg:#1d1d1b;--mut:#6b6b66;--line:#e3e2dc;--allow:#1f7a4a;--review:#9a6a00;--block:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--mut:#9b9a94;--line:#2c2c2a;--allow:#5cc28c;--review:#e0b64a;--block:#f08178}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px}
table{border-collapse:collapse;width:100%;margin:6px 0 18px}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)}
code{font-size:12px;word-break:break-all}small,.mut{color:var(--mut)}.ALLOW td:nth-child(3){color:var(--allow)}.REVIEW td:nth-child(3){color:var(--review)}.BLOCK td:nth-child(3){color:var(--block)}
section{overflow-x:auto}
</style></head><body>
<h1>Fiangshi Index</h1>
<p class="mut">The model advises, the vows decide. Advisory only. Policy band = deterministic score + vows (no model).</p>
<p>snapshot <code>${snap.snapshot_id}</code> · source ${snap.payload.source} · ${rows.length} payees · ALLOW ${counts.ALLOW} · REVIEW ${counts.REVIEW} · BLOCK ${counts.BLOCK}</p>
<h2>Clusters by funder</h2>
${clusterHtml}
</body></html>
`;
}
