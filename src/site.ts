/** Static index page (no JS, no framework, no CDN) rendered from the census, the lab results and measured demo stats. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, num } from "./config.js";
import type { Census, DemoStats } from "./census.js";
import { VOW_NAMES } from "./core/types.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const ZERO = "0x0000000000000000000000000000000000000000";

interface LabResult { id: string; archetype: string; payee: string; url: string | null; actual: Record<string, any> }

export function latestLab(): { file: string; ran_at: string; results: LabResult[] } | null {
  const dir = join(ROOT, "fixtures", "lab");
  try {
    const files = readdirSync(dir).filter((f) => /^results(-attempt\d+)?\.json$/.test(f)).sort((a, b) => a.length - b.length || a.localeCompare(b));
    if (!files.length) return null;
    const f = files[files.length - 1]!;
    return { file: f, ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as { ran_at: string; results: LabResult[] }) };
  } catch {
    return null;
  }
}

/** Featured = a live lab control that reached ALLOW with a corroborated name; highest live score wins. */
export function featured(c: Census) {
  const lab = latestLab();
  const cands = (lab?.results ?? []).filter((r) => r.archetype === "control" && r.actual.band === "ALLOW" && (r.actual.identity?.sources ?? []).length > 0);
  cands.sort((a, b) => b.actual.score - a.actual.score);
  const best = cands[0];
  const p = best ? c.payees.find((x) => x.payee === best.payee) : c.payees.filter((x) => x.band === "ALLOW" && (x.identity.sources ?? []).length > 0).sort((a, b) => b.score - a.score)[0];
  return p ? { payee: p, live: best?.actual ?? null, lab: lab?.file ?? null, labAt: lab?.ran_at ?? null } : null;
}

export function cautionary(c: Census) {
  const p = c.payees.find((x) => x.payee === ZERO);
  const b5 = latestLab()?.results.find((r) => r.archetype === "void");
  const livePrice = b5?.actual.probe ? /\$([0-9.]+)/.exec(String(b5.actual.probe))?.[1] : undefined;
  return p ? { payee: p, livePrice: livePrice ? Number(livePrice) : null, catalogPrice: p.price_usd } : null;
}

export function renderIndex(c: Census, stats: DemoStats | null): string {
  const f = featured(c);
  const z = cautionary(c);
  const n = c.payees.length;
  const pct = (x: number) => `${((100 * x) / Math.max(1, c.catalog_payees)).toFixed(1)}%`;
  const cached = num("FIANGSHI_PRICE_CHECK", 0.05);
  const cold = num("FIANGSHI_PRICE_CHECK_COLD", 0.15);
  const funderRows = c.funders
    .slice(0, 14)
    .map((r) => `<tr><td><code>${esc(short(r.funder))}</code></td><td>${r.payees}</td><td class="${r.status === "shared unnamed funder" ? "warn" : "ok"}">${esc(r.status)}${r.label ? ` · ${esc(r.label)}` : ""}</td><td>${r.kinship_fires ? "BLOCK (kinship)" : "exempt"}</td></tr>`)
    .join("");
  const unnamed = c.funders.filter((r) => r.status === "shared unnamed funder").length;
  const named = c.funders.length - unnamed;
  const fcard = f
    ? `<section class="card allow"><p class="tag">Featured · ALLOW</p><h3>${esc(f.payee.service ?? f.payee.url)}</h3>
<p><code>${esc(f.payee.url)}</code></p>
<p>Payee <code>${esc(f.payee.payee)}</code>. Census score <strong>${f.payee.score}</strong>; the name is corroborated by ${esc((f.payee.identity.sources ?? []).join(" + "))}. No vow fired.</p>
${f.live ? `<p>Live full pipeline (lab ${esc(f.labAt?.slice(0, 10) ?? "")}): score ${f.live.score}, SERV advised ${esc(String(f.live.model_band))}, final <strong>${esc(String(f.live.band))}</strong>; enrichment ${esc(f.live.enrichment?.status ?? "n/a")}.</p>` : ""}
<p>Receipt <code>${esc(f.payee.receipt_id)}</code> · <a href="/v1/verify?id=${esc(f.payee.receipt_id)}">verify it</a> · <a href="/v1/receipt/${esc(f.payee.receipt_id)}">raw JSON</a></p></section>`
    : "";
  const zcard = z
    ? `<section class="card block"><p class="tag">Cautionary · BLOCK at $0.00</p><h3>${esc(z.payee.url.replace(/^https?:\/\//, ""))}</h3>
<p>Asks <strong>$${(z.livePrice ?? z.catalogPrice ?? 0).toFixed(2)}</strong>${z.livePrice !== null && z.catalogPrice !== null && z.livePrice !== z.catalogPrice ? ` (was $${z.catalogPrice.toFixed(2)})` : ""} paid to <code>${ZERO}</code>, the zero address. Money sent there is unrecoverable.</p>
<p>V6 (null payee) BLOCKs it at probe time, before any data or model call. <strong>Cost: $0.00.</strong></p>
<p>Receipt <code>${esc(z.payee.receipt_id)}</code> · <a href="/v1/verify?id=${esc(z.payee.receipt_id)}">verify it</a></p></section>`
    : "";
  const statsLine = stats
    ? `warm p50 ${(stats.warm_p50_ms / 1000).toFixed(1)} s (measured ${esc(stats.measured_at.slice(0, 10)) } by <code>npm run localhost-check</code>) · ${stats.tests_passed} tests passing · accept ${esc(stats.accept)}`
    : `latency and test counts appear here after <code>npm run localhost-check</code>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fiangshi</title>
<style>
:root{--bg:#fbfbf8;--fg:#1d1d1b;--mut:#66665f;--line:#e3e2dc;--card:#fff;--allow:#1f7a4a;--review:#9a6a00;--block:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--mut:#9b9a94;--line:#2c2c2a;--card:#1c1c1b;--allow:#5cc28c;--review:#e0b64a;--block:#f08178}}
*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1040px;padding:16px}
h1{margin:.2em 0}h2{margin-top:1.6em}.mut{color:var(--mut)}code{font-size:12.5px;word-break:break-all}
.head{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.n{flex:1 1 150px;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:12px}
.n b{display:block;font-size:30px}.ALLOW b{color:var(--allow)}.REVIEW b{color:var(--review)}.BLOCK b{color:var(--block)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.card{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:14px}
.card.allow{border-left:5px solid var(--allow)}.card.block{border-left:5px solid var(--block)}.tag{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
.card h3{margin:.2em 0}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
td.warn{color:var(--review)}td.ok{color:var(--allow)}.scroll{overflow-x:auto}footer{margin-top:2em;padding-top:12px;border-top:1px solid var(--line);color:var(--mut);font-size:13.5px}
a{color:inherit}
</style></head><body>
<h1>Fiangshi</h1>
<p class="mut">A pre-payment counterparty oracle for x402 agent payments. The model advises, the vows decide. Advisory only; Fiangshi never holds funds.</p>
<div class="head">
<div class="n ALLOW"><b>${c.bands.ALLOW}</b>ALLOW</div><div class="n REVIEW"><b>${c.bands.REVIEW}</b>REVIEW</div><div class="n BLOCK"><b>${c.bands.BLOCK}</b>BLOCK</div>
</div>
<p><strong>${n} of ${c.catalog_payees.toLocaleString("en-US")} Base payees, ${c.window_days}-day window</strong> (${pct(n)} of the x402 Bazaar catalog; ${c.base_resources.toLocaleString("en-US")} Base resources, ${c.endpoints_per_payee} endpoints per payee). Census taken ${esc(c.at.slice(0, 16).replace("T", " "))} UTC.</p>
<div class="cards">${fcard}${zcard}</div>
<h2>Shared funders</h2>
<p class="mut">Payees whose first incoming transfer came from the same wallet. Exchanges and relayers fund many wallets legitimately and are exempt from the kinship vow. A <em>shared unnamed funder</em> is one Surf could not name: treat its payees as one counterparty until you know otherwise. ${named} of these ${c.funders.length} funders are named; ${unnamed} are not.</p>
<div class="scroll"><table><tr><th>funder</th><th>payees</th><th>status</th><th>kinship</th></tr>${funderRows}</table></div>
<p class="mut">Machine-readable: <a href="/v1/index.json">/v1/index.json</a> · badges: <code>/v1/badge/&lt;address&gt;.svg</code> · receipts: <code>/v1/receipt/&lt;id&gt;</code>, <code>/v1/verify?id=&lt;id&gt;</code></p>
<footer>${statsLine} · $${cached.toFixed(2)} per cached check · $${cold.toFixed(2)} per cold check · six vows: ${VOW_NAMES.map((v) => esc(v)).join(", ")}. Settlement is dry-run in this build.</footer>
</body></html>
`;
}

export function badgeSvg(band: string | null, score: number | null): string {
  const color = band === "ALLOW" ? "#1f7a4a" : band === "REVIEW" ? "#9a6a00" : band === "BLOCK" ? "#b3261e" : "#66665f";
  const text = band ? `${band}${score !== null ? ` ${Math.round(score)}` : ""}` : "UNKNOWN";
  const w = 74 + text.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="fiangshi: ${esc(text)}"><rect width="70" height="20" fill="#333"/><rect x="70" width="${w - 70}" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,sans-serif" font-size="11"><text x="8" y="14">fiangshi</text><text x="78" y="14">${esc(text)}</text></g></svg>`;
}
