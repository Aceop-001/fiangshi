/**
 * The HTML pages (no JS, no framework, no CDN), rendered from the census, the lab results and measured demo stats:
 *   renderIndex   /               landing + census + case files + vows + funders + ledger
 *   renderCheck   /check?url=     free probe result (unpaid GET, null-payee gate, cached census band)
 *   renderReceipt /receipt/:id    a sealed receipt as a paper slip, with its verification result
 * Only free-tier data is shown: what /v1/index.json and /v1/receipt/:id already return, plus the public 402 terms.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, env, num } from "./config.js";
import type { Census, CensusPayee, DemoStats } from "./census.js";
import { USDC_BASE } from "./adapters/x402.js";
import { VOW_NAMES, type Band, type Receipt, type Terms, type VowName } from "./core/types.js";
import { renderMarkdown } from "./md.js";
import { HERO_CSS, SITE_LINKS, bareUrl, esc, logoSvg, page, probeForm, short, usd } from "./site-theme.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const BANDS = ["ALLOW", "REVIEW", "BLOCK"] as const;
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

/** The six vows in precedence order, in the words the pages use. */
const VOWS: Record<VowName, { band: Band; rule: string }> = {
  null_payee: { band: "BLOCK", rule: "The payment address is the zero address, a burn sink, the token contract itself, or fails its EIP-55 checksum. Checked at probe time, before any data or model call." },
  age: { band: "BLOCK", rule: "The payee wallet was first seen less than 48 hours ago." },
  kinship: { band: "BLOCK", rule: "The wallet that first funded the payee also first funded three or more other catalog payees. Exchanges and relayers are exempt." },
  history: { band: "REVIEW", rule: "Nobody has paid this wallet yet, and it asks more than $0.50." },
  identity: { band: "BLOCK", rule: "The claimed name is contradicted by an on-chain label. A claim that is merely unverified is neutral: it scores the same as no claim." },
  silence: { band: "REVIEW", rule: "A required on-chain signal is missing. Missing data is never read as ALLOW." },
};
const vowNo = (v: string) => ROMAN[VOW_NAMES.indexOf(v as VowName)] ?? "";

const chip = (band: string) => `<span class="chip"><i class="st ${esc(band)}"></i>${esc(band)}</span>`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const censusStatus = (c: Census) => `census ${c.at.slice(0, 16).replace("T", " ")} UTC · ${c.window_days}-day window`;

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

function footer(c: Census, stats: DemoStats | null): string {
  const cached = num("FIANGSHI_PRICE_CHECK", 0.05);
  const cold = num("FIANGSHI_PRICE_CHECK_COLD", 0.15);
  const measured = stats
    ? `Warm p50 ${stats.warm_p50_ms} ms, measured ${esc(stats.measured_at.slice(0, 10))} by <code>npm run localhost-check -- --live</code> · ${stats.tests_passed} tests passing · accept ${esc(stats.accept)}.`
    : `Latency and test counts appear here after <code>npm run localhost-check -- --live</code>.`;
  return `<p>${measured} $${cached.toFixed(2)} per cached check · $${cold.toFixed(2)} per cold check · six vows: ${VOW_NAMES.map((v) => esc(v)).join(", ")}.</p>
<p>Advisory only. Fiangshi never holds funds, signs or sends a transaction. Receipts are hash-chained, not signed. Settlement is dry-run in this build. Census of ${c.payees.length} payees taken ${esc(c.at.slice(0, 16).replace("T", " "))} UTC.</p>`;
}

/* ---------------------------------------------------------------- index ---------------------------------------- */

/** Score histogram in 2-point bins, each column split by FINAL band: where the vows overrode the score is visible. */
function scoreChart(c: Census): string {
  const BIN = 2;
  const NB = 100 / BIN;
  const bins = Array.from({ length: NB }, () => ({ ALLOW: 0, REVIEW: 0, BLOCK: 0 }));
  for (const p of c.payees) bins[Math.min(NB - 1, Math.max(0, Math.floor(p.score / BIN)))]![p.band]++;
  const tot = (b: (typeof bins)[number]) => b.ALLOW + b.REVIEW + b.BLOCK;
  const max = Math.max(1, ...bins.map(tot));
  const step = max <= 30 ? 10 : max <= 80 ? 20 : max <= 200 ? 50 : 100;
  const yMax = Math.ceil(max / step) * step;
  const yTicks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const range = (i: number) => `${i * BIN}–${i === NB - 1 ? 100 : i * BIN + BIN}`;
  const cols = bins
    .map((b, i) => {
      const t = tot(b);
      const segs = BANDS.filter((k) => b[k] > 0).map((k) => `<i class="${k}" style="flex-grow:${b[k]}"></i>`).join("");
      const tip = t ? `<span class="tip"><b>${t}</b> ${t === 1 ? "payee" : "payees"} · score ${range(i)}${BANDS.map((k) => `<br><i class="st ${k}"></i><b>${b[k]}</b> ${k}`).join("")}</span>` : "";
      return `<div class="bin${i < 9 ? " l" : i > NB - 10 ? " r" : ""}"><span class="sp" style="flex-grow:${yMax - t}"></span>${t ? `<div class="col" style="flex-grow:${t};--i:${i}">${segs}</div>` : ""}${tip}</div>`;
    })
    .join("");
  const blockedAbove = c.payees.filter((p) => p.band === "BLOCK" && p.score >= 50).length;
  const rows = bins
    .map((b, i) => (tot(b) ? `<tr><td>${range(i)}</td><td class="n">${b.ALLOW}</td><td class="n">${b.REVIEW}</td><td class="n">${b.BLOCK}</td><td class="n">${tot(b)}</td></tr>` : ""))
    .join("");
  return `<figure class="chart hud">
<figcaption class="hud-h"><span>Score and final band</span><span>${c.payees.length} payees</span></figcaption>
<div class="hud-b">
<p class="chart-sub">Each column is a 2-point score range and its height is the number of payees. The fill is the final band, after the vows. Score alone would give BLOCK under 50, REVIEW from 50 to 79 and ALLOW from 80.</p>
<p class="legend">${BANDS.map((k) => `<span><i class="st ${k}"></i>${k}</span>`).join("")}</p>
<div class="plot-grid" role="img" aria-label="Histogram of ${c.payees.length} payee scores in 2-point bins, split by final band. The table below it has the same numbers.">

<div class="zones"><span style="flex:50"><b>under 50</b>BLOCK by score</span><span style="flex:30"><b>50–79</b>REVIEW at best</span><span style="flex:20"><b>80+</b>ALLOW if no vow</span></div>
<div class="yax">${yTicks.map((v) => `<span style="bottom:${((100 * v) / yMax).toFixed(2)}%">${v}</span>`).join("")}</div>
<div class="plot">${yTicks.slice(1).map((v) => `<i class="gl" style="bottom:${((100 * v) / yMax).toFixed(2)}%"></i>`).join("")}<i class="thr" style="left:50%"></i><i class="thr" style="left:80%"></i><div class="bins">${cols}</div></div>
<div class="xax">${[0, 20, 40, 50, 60, 80, 100].map((v) => `<span${v === 50 || v === 80 ? ' class="on"' : ""} style="left:${v}%">${v}</span>`).join("")}</div>
<span class="xax-t">score</span>
</div>
<p class="insight"><strong>${plural(blockedAbove, "payee")} score 50 or more and are still BLOCKed.</strong> A vow overrode the score in each case. The score and the model advise; the vows decide.</p>
<details class="twin"><summary>View as table</summary><div class="scroll"><table class="tbl"><tr><th>score</th><th class="n">ALLOW</th><th class="n">REVIEW</th><th class="n">BLOCK</th><th class="n">payees</th></tr>${rows}</table></div><p class="mut">Empty score ranges are omitted.</p></details>
</div></figure>`;
}

interface Exhibit { tag: string; band: Band | null; href: string | null; fig: string; figSub: string; title: string; sub: string; noteTitle: string; note: string }

/** Up to five cases from the census: the featured ALLOW, then one live case per vow that has one, then an empty frame. */
function exhibits(c: Census): Exhibit[] {
  const out: Exhibit[] = [];
  const fired = (v: VowName) => c.payees.filter((p) => p.vows.includes(v)).length;
  const f = featured(c);
  if (f) {
    const p = f.payee;
    const name = p.service ?? bareUrl(p.url);
    const src = (p.identity.sources ?? []).join(" + ");
    out.push({
      tag: "Featured · ALLOW", band: "ALLOW", href: `/receipt/${p.receipt_id}`, fig: String(p.score), figSub: "census score · no vow fired", title: name, sub: `${short(p.payee)} · view receipt`,
      noteTitle: `${name}: ALLOW`,
      note: `Census score ${p.score}.${src ? ` The listing name is corroborated by ${esc(src)}.` : ""} No vow fired.${f.live ? ` Live full pipeline on ${esc(f.labAt?.slice(0, 10) ?? "")}: score ${esc(String(f.live.score))}, SERV advised ${esc(String(f.live.model_band))}, final ${esc(String(f.live.band))}.` : ""}`,
    });
  }
  const z = cautionary(c);
  if (z) {
    const now = z.livePrice ?? z.catalogPrice;
    const was = z.livePrice !== null && z.catalogPrice !== null && z.livePrice !== z.catalogPrice ? ` (the catalog said ${usd(z.catalogPrice)})` : "";
    out.push({
      tag: "Null payee · BLOCK", band: "BLOCK", href: `/receipt/${z.payee.receipt_id}`, fig: usd(now), figSub: "asked, payable to the zero address", title: bareUrl(z.payee.url), sub: `${short(ZERO)} · blocked at $0.00`,
      noteTitle: `${bareUrl(z.payee.url)}: BLOCK at $0.00`,
      note: `Asks ${usd(now)}${was}, payable to the zero address. Money sent there is unrecoverable. On the score alone it would pass (${z.payee.score}). The null-payee vow blocks it at probe time, before any data or model call.`,
    });
  }
  const k = c.funders.find((r) => r.kinship_fires);
  if (k) {
    out.push({
      tag: "Kinship · BLOCK", band: "BLOCK", href: "#funders", fig: String(k.payees), figSub: "sellers, one first funder", title: `One wallet funded ${k.payees} sellers`, sub: `${short(k.funder)} · unnamed`,
      noteTitle: `${k.payees} sellers, one funder: BLOCK`,
      note: `${esc(short(k.funder))} sent the first transfer to ${k.payees} census payees, and Surf has no name for it. The kinship vow treats them as one counterparty. ${plural(fired("kinship"), "payee")} are blocked this way. Treat that as an upper bound: an unnamed funder may still be an exchange.`,
    });
  }
  const s = c.payees.filter((p) => p.band === "REVIEW" && p.vows.includes("silence")).sort((a, b) => b.score - a.score || a.payee.localeCompare(b.payee))[0];
  if (s) {
    const name = s.service ?? bareUrl(s.url);
    out.push({
      tag: "Silence · REVIEW", band: "REVIEW", href: `/receipt/${s.receipt_id}`, fig: String(s.score), figSub: "a required signal is missing", title: name, sub: `${short(s.payee)} · view receipt`,
      noteTitle: `${name}: REVIEW`,
      note: `A required on-chain signal is missing for this wallet, so the silence vow holds it at REVIEW. ${plural(fired("silence"), "payee")} are held this way. Missing data is never read as ALLOW.`,
    });
  }
  const quiet = VOW_NAMES.filter((v) => fired(v) === 0);
  if (quiet.length && out.length < 5) {
    out.push({
      tag: "No live case", band: null, href: null, fig: "?", figSub: "", title: "Empty frame", sub: `${quiet.join(", ")}: 0 of ${c.payees.length}`,
      noteTitle: `No live case: ${quiet.join(", ")}`,
      note: `${quiet.length === 1 ? "This vow has" : "These vows have"} not fired on any of the ${c.payees.length} census payees. ${quiet.includes("age") ? "No payee is under 48 hours old inside the 90-day window. " : ""}${quiet.length === 1 ? "It is" : "They are"} tested on fixtures only, and the frame stays empty until a live case exists.`,
    });
  }
  return out.slice(0, 5);
}

function caseFiles(c: Census): string {
  const ex = exhibits(c);
  if (!ex.length) return "";
  const tilt = [-3, 2, -1.5, 2.5, -2];
  const pins = ex
    .map((e, i) => {
      const t = (i + 0.5) / ex.length;
      const y = Math.round(6 + 2 * t * (1 - t) * 52); // the cord is the quadratic M0,6 Q50,58 100,6: this is its height at t
      const letter = String.fromCharCode(65 + i);
      const photo = e.band
        ? `<span class="photo ${e.band}"><span class="ph-tag">Exhibit ${letter} · ${esc(e.tag)}</span><span class="stamp">${e.band}</span><span class="ph-fig">${esc(e.fig)}<small>${esc(e.figSub)}</small></span></span>`
        : `<span class="photo blank"><b aria-hidden="true">?</b></span>`;
      const inner = `<span class="peg"></span>${photo}<span class="cap"><b>${esc(e.title)}</b><small>${esc(e.band ? e.sub : `Exhibit ${letter} · ${e.sub}`)}</small></span>`;
      const style = `--y:${y}px;--r:${tilt[i % tilt.length]}deg;--d:-${(i * 2.3).toFixed(1)}s`;
      return `<li style="${style}">${e.href ? `<a class="polaroid" href="${esc(e.href)}">${inner}</a>` : `<div class="polaroid">${inner}</div>`}</li>`;
    })
    .join("");
  const notes = ex.map((e, i) => `<li><span class="k">${String.fromCharCode(65 + i)}</span><div><h3>${esc(e.noteTitle)}</h3><p>${e.note}</p></div></li>`).join("");
  return `<section class="sec" id="cases"><div class="wrap">
<p class="eyebrow">Case files</p>
<h2>What the census turned up</h2>
<p class="lede">Real payees from the x402 Bazaar catalog, each with a sealed receipt. One frame is empty on purpose.</p>
<div class="string-scroll" tabindex="0" role="region" aria-label="Case files, scroll sideways">
<div class="string"><svg class="cord" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0,6 Q50,58 100,6" vector-effect="non-scaling-stroke"/></svg>
<ol class="pins" style="grid-template-columns:repeat(${ex.length},1fr)">${pins}</ol></div></div>
<ol class="notes">${notes}</ol>
</div></section>`;
}

function ledger(c: Census): string {
  const row = (p: CensusPayee) => {
    const u = bareUrl(p.url);
    const slash = u.indexOf("/");
    const who = p.service ? `<b>${esc(clip(p.service, 60))}</b><small>${esc(clip(u, 70))}</small>` : `<b>${esc(slash < 0 ? u : u.slice(0, slash))}</b><small>${esc(clip(slash < 0 ? "" : u.slice(slash), 60))}</small>`;
    return `<tr><td class="n">${p.score.toFixed(2)}</td><td>${who}</td><td><code>${esc(short(p.payee))}</code></td><td>${p.vows.length ? esc(p.vows.join(", ")) : "–"}</td><td><a href="/receipt/${p.receipt_id}">receipt</a></td></tr>`;
  };
  return BANDS.map((b) => {
    const rows = c.payees.filter((p) => p.band === b).sort((x, y) => y.score - x.score || x.payee.localeCompare(y.payee));
    return `<details class="led"><summary><i class="st ${b}"></i>${b}<span>${plural(rows.length, "payee")}</span></summary><div class="scroll"><table class="tbl"><tr><th class="n">score</th><th>seller</th><th>payee</th><th>vows fired</th><th>receipt</th></tr>${rows.map(row).join("")}</table></div></details>`;
  }).join("");
}

export function renderIndex(c: Census, stats: DemoStats | null): string {
  const n = c.payees.length;
  const f = featured(c);
  const z = cautionary(c);
  const share = (x: number) => `${((100 * x) / Math.max(1, n)).toFixed(1)}%`;
  const fired = (v: VowName) => c.payees.filter((p) => p.vows.includes(v)).length;
  const tileNote: Record<Band, string> = { ALLOW: "passed every check", REVIEW: "a human or a tighter budget decides", BLOCK: "a vow fired, or the score is under 50" };
  const tries = [z?.payee.url, f?.payee.url].filter((u): u is string => Boolean(u)).map((u) => `<a href="/check?url=${encodeURIComponent(u)}">${esc(bareUrl(u))}</a>`);
  const unnamed = c.funders.filter((r) => r.status === "shared unnamed funder").length;
  const funderRows = c.funders
    .slice(0, 14)
    .map((r) => `<tr><td><code>${esc(short(r.funder))}</code></td><td class="n">${r.payees}</td><td>${esc(r.status)}${r.label ? ` · ${esc(r.label)}` : ""}</td><td>${r.kinship_fires ? chip("BLOCK") : "exempt"}</td></tr>`)
    .join("");
  const cached = num("FIANGSHI_PRICE_CHECK", 0.05);
  const payeePrice = num("FIANGSHI_PRICE_PAYEE", 0.02);

  const body = `<section class="hero"><div class="rain" aria-hidden="true"></div><div class="wrap hero-in">
<div class="clock">${logoSvg({ bezel: true, label: "Fiangshi: a clock face with red roman numerals" })}</div>
<div class="hud"><div class="hud-h"><span>Pre-payment check</span><span>x402 · Base</span></div><div class="hud-b">
<p class="kicker">Counterparty oracle for agent payments</p>
<h1>Who is behind the&nbsp;402?</h1>
<p class="lede">Fiangshi checks the wallet behind an x402 paid endpoint before your agent pays it. It answers ALLOW, REVIEW or BLOCK, quotes its evidence, and seals a receipt you can verify again later. Advisory only: it never holds funds.</p>
${probeForm()}
<p class="try">Free: one unpaid request, the null-payee gate and the census band.${tries.length ? ` Try ${tries.join(" or ")}.` : ""}</p>
</div></div>
</div></section>

<section class="sec" id="census"><div class="wrap">
<p class="eyebrow">Census</p>
<h2>${n} of ${c.catalog_payees.toLocaleString("en-US")} Base payees, ${c.window_days}-day window</h2>
<p class="lede">${((100 * n) / Math.max(1, c.catalog_payees)).toFixed(1)}% of the x402 Bazaar catalog on Base. The catalog lists ${c.base_resources.toLocaleString("en-US")} paid endpoints, but they resolve to ${c.catalog_payees.toLocaleString("en-US")} wallets: ${c.endpoints_per_payee} endpoints per payee. Spreading payments across endpoints is not spreading them across counterparties. These counts are defined in <code>data/numbers.json</code> (<code>npx tsx scripts/numbers.ts</code>).</p>
<div class="tiles">${BANDS.map((b) => `<div class="tile ${b}"><p class="tile-l"><i class="st ${b}"></i>${b}</p><p class="tile-v">${c.bands[b]}</p><p class="tile-s">${share(c.bands[b])} · ${tileNote[b]}</p></div>`).join("")}</div>
<div class="seg" role="img" aria-label="${BANDS.map((b) => `${b} ${c.bands[b]} (${share(c.bands[b])})`).join(", ")}">${BANDS.map((b) => `<i class="${b}" style="flex-grow:${c.bands[b]}" title="${b} ${c.bands[b]} · ${share(c.bands[b])}"></i>`).join("")}</div>
${scoreChart(c)}
</div></section>

${caseFiles(c)}

<section class="sec" id="vows"><div class="wrap">
<p class="eyebrow">How a verdict is made</p>
<h2>The model advises, the vows decide.</h2>
<p class="lede">Six fixed rules run after the model and can only lower a verdict. The model has no power to raise one. The final band is the lowest of the score band, the model's band and the vow band.</p>
<ol class="pipe">
<li><i>01</i><b>Probe</b><span>One unpaid GET. Parse the 402 terms.</span></li>
<li><i>02</i><b>Gate</b><span>Null payee? BLOCK, at $0.00.</span></li>
<li><i>03</i><b>Score</b><span>25M + 20P + 20R + 15I + 10E + 10C.</span></li>
<li><i>04</i><b>Model</b><span>SERV advises. Every quote must match stored evidence.</span></li>
<li><i>05</i><b>Vows</b><span>Six rules. They only lower.</span></li>
<li><i>06</i><b>Receipt</b><span>sha256, chained to the one before.</span></li>
</ol>
<ol class="vows">${VOW_NAMES.map((v, i) => `<li><span class="num">${ROMAN[i]}</span><div><h3>${esc(v)} ${chip(VOWS[v].band)}</h3><p>${esc(VOWS[v].rule)}</p><p class="fired">Fired on ${fired(v)} of ${n} census payees.</p></div></li>`).join("")}</ol>
</div></section>

<section class="sec" id="funders"><div class="wrap">
<p class="eyebrow">Kinship</p>
<h2>Shared funders</h2>
<p class="lede">Payees whose first incoming transfer came from the same wallet. Exchanges and relayers fund many wallets legitimately and are exempt from the kinship vow. A shared unnamed funder is one Surf could not name: treat its payees as one counterparty until you know otherwise. ${c.funders.length - unnamed} of these ${c.funders.length} funders are named; ${unnamed} are not.</p>
<div class="scroll"><table class="tbl"><tr><th>first funder</th><th class="n">payees</th><th>status</th><th>kinship vow</th></tr>${funderRows}</table></div>
</div></section>

<section class="sec" id="ledger"><div class="wrap">
<p class="eyebrow">Ledger</p>
<h2>Every payee, every receipt</h2>
<p class="lede">All ${n} census verdicts, highest score first. Each one links to its sealed receipt.</p>
${ledger(c)}
</div></section>

<section class="sec" id="api"><div class="wrap">
<p class="eyebrow">API</p>
<h2>For agents</h2>
<p class="lede">Paid routes answer 402 with x402 v2 payment terms until an X-PAYMENT header is sent. Settlement is dry-run in this build: the header is checked for structure and nothing is settled. The <a href="/guide">guide</a> has the full flow with real requests and responses.</p>
<div class="scroll"><table class="tbl"><tr><th>route</th><th class="n">price</th><th>returns</th></tr>
<tr><td><code>GET /v1/check?url=</code></td><td class="n">$${cached.toFixed(2)}</td><td>Verdict, vows, SERV advice and a fresh receipt. A null payee answers BLOCK for free.</td></tr>
<tr><td><code>GET /v1/payee/:address</code></td><td class="n">$${payeePrice.toFixed(2)}</td><td>The census record for one payee.</td></tr>
<tr><td><a href="/v1/index.json"><code>GET /v1/index.json</code></a></td><td class="n">free</td><td>Every census payee: band, score, vows fired, receipt id.</td></tr>
<tr><td><code>GET /v1/receipt/:id</code></td><td class="n">free</td><td>A receipt as JSON.</td></tr>
<tr><td><code>GET /v1/verify?id=</code></td><td class="n">free</td><td>Recomputes the hash and the chain link. One changed byte gives valid: false.</td></tr>
<tr><td><code>GET /v1/badge/:address.svg</code></td><td class="n">free</td><td>A badge coloured by band.</td></tr>
</table></div>
</div></section>`;

  return page({
    title: "Fiangshi · who is behind the 402?",
    description: "Fiangshi checks the wallet behind an x402 paid endpoint before an agent pays it: ALLOW, REVIEW or BLOCK, with quoted evidence and a hash-chained receipt.",
    status: censusStatus(c),
    nav: [["#census", "Census"], ["#cases", "Cases"], ["#vows", "Vows"], ["#funders", "Funders"], ["#ledger", "Ledger"], ["#api", "API"], ...SITE_LINKS],
    body,
    foot: footer(c, stats),
    css: HERO_CSS,
  });
}

/* ---------------------------------------------------------------- check ---------------------------------------- */

export type CheckView =
  | { kind: "invalid"; input: string }
  | { kind: "probe_failed"; url: string; error: string }
  | { kind: "blocked"; url: string; terms: Terms; payTo: string; reason: string; receipt: Receipt }
  | { kind: "census"; url: string; terms: Terms; payTo: string; payee: CensusPayee }
  | { kind: "unknown"; url: string; terms: Terms; payTo: string };

const kv = (k: string, v: string) => `<div class="kv"><dt>${esc(k)}</dt><i></i><dd>${v}</dd></div>`;

function termsRows(url: string, terms: Terms, payTo: string): string {
  const asset = terms.asset.toLowerCase() === USDC_BASE.toLowerCase() ? "USDC" : short(terms.asset);
  return [
    kv("Endpoint", `<code>${esc(url)}</code>`),
    kv("Asks", `${esc(usd(terms.price))} in ${esc(asset)} on ${esc(terms.network)}`),
    kv("Pay to", `<code>${esc(payTo)}</code>`),
    kv("Terms hash", `<code>${esc(short(terms.terms_hash, 12, 8))}</code>`),
  ].join("");
}

export function renderCheck(v: CheckView, c: Census, self: string, stats: DemoStats | null): string {
  const cached = num("FIANGSHI_PRICE_CHECK", 0.05);
  const payeePrice = num("FIANGSHI_PRICE_PAYEE", 0.02);
  const url = v.kind === "invalid" ? v.input : v.url;
  const paidCmd = (u: string) => `<code class="cmd">curl -i "${esc(self)}/v1/check?url=${esc(encodeURIComponent(u))}"</code>`;
  let verdict = "";
  let detail = "";

  if (v.kind === "invalid") {
    verdict = `<div class="verdict NONE"><span class="stamp">NO URL</span><div><h2>That is not an http or https URL.</h2><p>Paste the full address of a paid endpoint, for example https://api.example.com/paid.</p></div></div>`;
  } else if (v.kind === "probe_failed") {
    verdict = `<div class="verdict NONE"><span class="stamp">NO VERDICT</span><div><h2>The probe did not get usable payment terms.</h2><p>${esc(v.error)}</p><p>Fiangshi fails closed: without a parsed 402 it gives no verdict, and a paid check would answer REVIEW.</p></div></div>`;
  } else if (v.kind === "blocked") {
    const r = v.receipt;
    verdict = `<div class="verdict BLOCK"><span class="stamp">BLOCK</span><div><h2>Blocked at probe time by vow ${vowNo("null_payee")}, null_payee.</h2><p>${esc(v.reason)}.</p><p>No data or model call was made. Cost: $0.00.</p></div></div>`;
    detail = `<div class="hud"><div class="hud-h"><span>Probe</span><span>unpaid GET</span></div><dl class="hud-b kvs">${termsRows(v.url, v.terms, v.payTo)}${kv("Receipt", `<a href="/receipt/${r.receipt_hash}"><code>${esc(short(r.receipt_hash, 12, 8))}</code></a>`)}</dl></div>
<div class="cols"><div><p class="eyebrow">Why</p><ul class="quotes"><li><b>Vow ${vowNo("null_payee")} · null_payee</b>${esc(VOWS.null_payee.rule)}</li></ul></div>
<div><p class="eyebrow">Same answer for an agent</p><ul class="next"><li>Free, as JSON, with the sealed receipt:<code class="cmd">curl "${esc(self)}/v1/check?url=${esc(encodeURIComponent(v.url))}"</code></li></ul></div></div>`;
  } else if (v.kind === "census") {
    const p = v.payee;
    const r = c.receipts.get(p.receipt_id);
    const firedList = p.vows.length ? `Vows fired: ${p.vows.map((x) => `${vowNo(x)} ${x}`).join(", ")}.` : "No vow fired.";
    const drift = p.price_usd !== null && v.terms.price !== null && p.price_usd !== v.terms.price ? kv("Catalog price", `${esc(usd(p.price_usd))} when the census ran`) : "";
    const funder = p.vows.includes("kinship") && p.first_funder ? c.funders.find((x) => x.funder === p.first_funder) : undefined;
    verdict = `<div class="verdict ${p.band}"><span class="stamp">${p.band}</span><div><h2>Census band ${p.band}, score ${p.score}.</h2><p>${esc(firedList)} This is the cached census verdict: score and vows over ${c.window_days} days of on-chain data, with no model call.</p></div></div>`;
    detail = `<div class="hud"><div class="hud-h"><span>Probe</span><span>unpaid GET</span></div><dl class="hud-b kvs">${termsRows(v.url, v.terms, v.payTo)}${drift}${p.service ? kv("Listed as", esc(p.service)) : ""}${kv("Census receipt", `<a href="/receipt/${p.receipt_id}"><code>${esc(short(p.receipt_id, 12, 8))}</code></a>`)}</dl></div>
<div class="cols"><div><p class="eyebrow">${p.vows.length ? "Why" : "Evidence on the receipt"}</p><ul class="quotes">${p.vows.map((x) => `<li><b>Vow ${vowNo(x)} · ${esc(x)}</b>${esc(VOWS[x as VowName]?.rule ?? "")}${x === "kinship" && funder ? ` This payee's first funder also first funded ${funder.payees - 1} other census payees.` : ""}</li>`).join("")}${(r?.evidence ?? []).map((e) => `<li><b>${esc(e.signal)}</b>${esc(e.quote)}</li>`).join("")}</ul></div>
<div><p class="eyebrow">Go further</p><ul class="next"><li>A paid check adds SERV adjudication on the live terms and seals a fresh receipt. $${cached.toFixed(2)} over x402:${paidCmd(v.url)}</li><li>The full census record for this payee. $${payeePrice.toFixed(2)} over x402:<code class="cmd">curl -i "${esc(self)}/v1/payee/${esc(p.payee)}"</code></li></ul></div></div>`;
  } else {
    verdict = `<div class="verdict NONE"><span class="stamp">NO RECORD</span><div><h2>This payee is not in the census.</h2><p>Fiangshi has no cached on-chain signals for <code>${esc(short(v.terms.payee))}</code>. It passed the null-payee gate, and that is all a free probe can say. A paid check fails closed to REVIEW until the payee is in a snapshot. It is never ALLOW by default.</p></div></div>`;
    detail = `<div class="hud"><div class="hud-h"><span>Probe</span><span>unpaid GET</span></div><dl class="hud-b kvs">${termsRows(v.url, v.terms, v.payTo)}</dl></div>
<div class="cols"><div><p class="eyebrow">Go further</p><ul class="next"><li>A paid check, $${cached.toFixed(2)} over x402:${paidCmd(v.url)}</li></ul></div><div></div></div>`;
  }

  const body = `<main class="wrap case">
<p class="eyebrow">Probe result</p>
<h1>${esc(url ? bareUrl(url) : "No endpoint given")}</h1>
${verdict}
${detail}
<div class="again"><p class="eyebrow">Check another</p>${probeForm(v.kind === "invalid" ? v.input : "", "u2")}</div>
</main>`;
  return page({
    title: `${v.kind === "blocked" ? "BLOCK" : v.kind === "census" ? v.payee.band : "Probe"} · ${url ? clip(bareUrl(url), 60) : "Fiangshi"}`,
    description: "Fiangshi probe result: the unpaid 402 terms, the null-payee gate and the cached census band.",
    status: censusStatus(c),
    body,
    foot: footer(c, stats),
  });
}

/* ---------------------------------------------------------------- receipt -------------------------------------- */

/** A barcode drawn from the receipt hash itself (2 bits bar width, 2 bits gap per hex digit): a visual fingerprint. */
function hashBars(hash: string): string {
  let x = 0;
  let rects = "";
  for (const ch of hash) {
    const nib = parseInt(ch, 16) || 0;
    const w = 1 + (nib & 3);
    rects += `<rect x="${x}" y="0" width="${w}" height="40"/>`;
    x += w + 1 + (nib >> 2);
  }
  return `<svg class="bars" viewBox="0 0 ${x} 40" preserveAspectRatio="none" role="img" aria-label="Barcode drawn from the receipt hash"><g fill="#111">${rects}</g></svg>`;
}

export function renderReceipt(r: Receipt, proof: { valid: boolean; errors: string[]; chain: string }, c: Census, self: string, stats: DemoStats | null): string {
  const enr = r.enrichment ? `${r.enrichment.status}${r.enrichment.reason ? ` (${r.enrichment.reason})` : ""}` : null;
  const body = `<main class="wrap rc-wrap">
<article class="rc" aria-label="Receipt">
<div class="rc-head">${logoSvg()}<b>FIANGSHI</b><span>counterparty check receipt</span></div>
<hr>
<div class="rc-band ${r.band}"><span class="stamp">${r.band}</span><div><b>${r.score}</b><small>score</small></div></div>
<hr>
<dl class="kvs">${[
    kv("Endpoint", esc(clip(bareUrl(r.url), 80))),
    kv("Payee", `<code>${esc(r.payee)}</code>`),
    kv("Price", esc(usd(r.price))),
    kv("Vow fired", r.vow_fired ? esc(`${vowNo(r.vow_fired)} ${r.vow_fired}`) : "none"),
    kv("Model", esc(r.model.verdict ?? "none")),
    kv("Extractor", esc(r.model.extractor)),
    kv("Degraded", r.model.degraded ? "yes" : "no"),
    enr ? kv("Enrichment", esc(enr)) : "",
    kv("Settlement", esc(r.settlement)),
    kv("Checked at", esc(r.checked_at)),
  ].join("")}</dl>
<hr>
<h3>Evidence</h3>
<ul class="ev">${r.evidence.length ? r.evidence.map((e) => `<li><b>${esc(e.signal)}</b> ${esc(e.quote)}</li>`).join("") : "<li>none recorded</li>"}</ul>
<hr>
<h3>Chain</h3>
<dl class="kvs">${kv("Terms", `<code>${esc(short(r.terms_hash, 12, 8))}</code>`)}${kv("Snapshot", `<code>${esc(short(r.snapshot_id, 12, 8))}</code>`)}${kv("Previous", `<code>${esc(r.prev_hash === "genesis" ? "genesis" : short(r.prev_hash, 12, 8))}</code>`)}</dl>
<p class="hash"><code>${esc(r.receipt_hash)}</code></p>
${hashBars(r.receipt_hash)}
<p class="fine">hash-chained · not signed · advisory only</p>
</article>
<aside class="proof">
<p class="eyebrow">Verification</p>
<h1>${proof.valid ? "This receipt checks out." : "This receipt does not verify."}</h1>
<div class="hud"><div class="hud-h"><span>${proof.valid ? "Hash verified" : "Invalid"}</span><span>${esc(proof.chain)}</span></div><div class="hud-b">
<p class="big"><i class="st ${proof.valid ? "ALLOW" : "BLOCK"}"></i>${proof.valid ? "The receipt hashes to its own id, and it links to the receipt before it." : esc(proof.errors.join("; "))}</p>
<p class="mut">The id is the sha256 of the canonical JSON of every field except the id itself. Change one byte anywhere and the hash no longer matches. Each receipt also carries the id of the one before it, so removing or reordering a receipt breaks the chain.</p>
<ul class="next" style="margin-top:16px"><li>Recompute it yourself:<code class="cmd">curl "${esc(self)}/v1/verify?id=${esc(r.receipt_hash)}"</code></li><li>The receipt as JSON:<code class="cmd">curl "${esc(self)}/v1/receipt/${esc(r.receipt_hash)}"</code></li></ul>
</div></div>
<p class="try"><a href="/">Back to the census</a> · <a href="/check?url=${encodeURIComponent(r.url)}">probe this endpoint again</a></p>
</aside>
</main>`;
  return page({
    title: `Receipt ${r.receipt_hash.slice(0, 12)} · ${r.band}`,
    description: "A Fiangshi receipt: verdict, evidence and hash chain link.",
    status: censusStatus(c),
    body,
    foot: footer(c, stats),
  });
}

/* ---------------------------------------------------------------- documents ------------------------------------ */

const DOCS = {
  docs: { file: "GUIDE.md", fallback: "Fiangshi guide", description: "How an agent uses Fiangshi, how a verdict is made, and how to run it." },
  report: { file: "REPORT.md", fallback: "Test report", description: "Every failure in building Fiangshi, what fixed it, and what the tests say now." },
  legal: { file: "LEGAL.md", fallback: "Legal", description: "Fiangshi terms of use, what a verdict about a seller means, privacy, licence." },
} as const;
export type DocKind = keyof typeof DOCS;

/** The operator of this copy, from FIANGSHI_CONTACT (an https URL, an email address, or plain text). Never invented. */
function contactBlock(): string {
  const raw = env("FIANGSHI_CONTACT").trim();
  const shown = !raw
    ? `This copy of Fiangshi has no operator contact set. Whoever runs it for other people should set <code>FIANGSHI_CONTACT</code>.`
    : /^https:\/\/\S+$/.test(raw)
      ? `<a href="${esc(raw)}" rel="noreferrer">${esc(raw)}</a>`
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
        ? `<a href="mailto:${esc(raw)}">${esc(raw)}</a>`
        : esc(raw);
  return `<aside class="contact"><h2 id="operator-contact">Operator contact</h2><p>${shown}</p></aside>`;
}

/**
 * docs/GUIDE.md and docs/LEGAL.md rendered as pages: one source for the repository and the site.
 * Links between the two files (LEGAL.md, GUIDE.md) are pointed at their routes.
 */
export function renderDoc(kind: DocKind, c: Census, stats: DemoStats | null): string {
  const d = DOCS[kind];
  const src = readFileSync(join(ROOT, "docs", d.file), "utf8")
    .replace(/\]\(GUIDE\.md(#[^)\s]*)?\)/g, (_m, hash: string | undefined) => `](/guide${hash ?? ""})`)
    .replace(/\]\(LEGAL\.md(#[^)\s]*)?\)/g, (_m, hash: string | undefined) => `](/legal${hash ?? ""})`);
  const r = renderMarkdown(src);
  const extra = kind === "report" ? reportComputed(stats) : null;
  if (extra) r.headings.push(...extra.headings);
  const toc = r.headings.filter((h) => h.level === 2).map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`);
  const body = `<main class="wrap doc-wrap">
<nav class="toc" aria-label="On this page"><p class="eyebrow">On this page</p><ol>${toc.join("")}</ol></nav>
<article class="doc">${r.html}${extra?.html ?? ""}${kind === "legal" ? contactBlock() : ""}</article>
</main>`;
  return page({ title: `${r.title ?? d.fallback} · Fiangshi`, description: d.description, status: censusStatus(c), body, foot: footer(c, stats) });
}

/**
 * The computed half of the test report: every committed lab run (fixtures/lab/results*.json) and the latest measured
 * status (artifacts/demo-stats.json). Nothing here is typed by hand, so it cannot drift from the files.
 */
function reportComputed(stats: DemoStats | null): { html: string; headings: { level: number; id: string; text: string }[] } {
  const dir = join(ROOT, "fixtures", "lab");
  let sup: Record<string, unknown> = {};
  try {
    sup = (JSON.parse(readFileSync(join(dir, "supersessions.json"), "utf8")) as { cases: Record<string, unknown> }).cases;
  } catch {
    /* none */
  }
  const files = readdirSync(dir).filter((f) => /^results(-attempt\d+)?\.json$/.test(f)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const runs = files.map((f, i) => {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { ran_at: string; results: { id: string; outcome: string }[] };
    const pass = r.results.filter((x) => x.outcome === "PASS").length;
    const fails = r.results.filter((x) => x.outcome !== "PASS");
    const superseded = i > 0 ? fails.filter((x) => sup[x.id]).map((x) => x.id) : [];
    const failed = fails.filter((x) => !superseded.includes(x.id)).map((x) => x.id);
    const outcome = failed.length ? "fail" : superseded.length ? "pass with supersession" : "pass";
    return { f, at: r.ran_at.slice(0, 16).replace("T", " "), n: r.results.length, pass, superseded, failed, outcome };
  });
  const rows = runs
    .map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(r.at) + ' UTC</td><td class="n">' + r.pass + ' / ' + r.n + '</td><td>' + (r.failed.length ? esc(r.failed.join(", ")) : "none") + '</td><td>' + (r.superseded.length ? esc(r.superseded.join(", ")) : "none") + '</td><td>' + chip(r.outcome === "fail" ? "BLOCK" : r.outcome === "pass" ? "ALLOW" : "REVIEW").replace(/>(ALLOW|REVIEW|BLOCK)</, ">" + (r.outcome === "fail" ? "FAIL" : r.outcome === "pass" ? "PASS" : "SUPERSEDED") + "<") + '</td><td><code>' + esc(r.f) + '</code></td></tr>')
    .join("");
  const now = stats
    ? '<p>Last full measurement, ' + esc(stats.measured_at.slice(0, 10)) + ', by <code>npm run localhost-check -- --live</code> (it needs the model keys). Re-run it to refresh these numbers.</p><ul><li><strong>' + stats.tests_passed + ' tests</strong> passing (<code>npm test</code>).</li><li><strong>Accept gates ' + esc(stats.accept) + '</strong>, offline, with the network unplugged (<code>npm run accept</code>).</li><li><strong>End to end 10 / 10</strong>, warm check ' + stats.warm_p50_ms + ' ms.</li><li>A fresh copy with no keys passes all of these in fixture mode.</li></ul>'
    : "<p>Run <code>npm run localhost-check -- --live</code> to measure the current status.</p>";
  const html = '<h2 id="lab-runs">Lab runs, as committed</h2><p>Each run of the adversarial lab: 6 attack cases and 3 real sellers, each with an expected answer written before the run. Read from <code>fixtures/lab/</code> when this page loads.</p><div class="scroll"><table class="tbl"><tr><th>run</th><th>when</th><th class="n">passed</th><th>failed</th><th>superseded</th><th>outcome</th><th>file</th></tr>' + rows + '</table></div><h2 id="status-now">Last measured status</h2>' + now;
  return { html, headings: [{ level: 2, id: "lab-runs", text: "Lab runs, as committed" }, { level: 2, id: "status-now", text: "Last measured status" }] };
}

export function renderNotFound(what: string, c: Census, stats: DemoStats | null): string {
  return page({
    title: "Not found · Fiangshi",
    description: "Not found.",
    status: censusStatus(c),
    body: `<main class="wrap case"><p class="eyebrow">Not found</p><h1>${esc(what)}</h1><p class="try"><a href="/">Back to the census</a></p></main>`,
    foot: footer(c, stats),
  });
}

export function badgeSvg(band: string | null, score: number | null): string {
  const color = band === "ALLOW" ? "#1f7a4a" : band === "REVIEW" ? "#9a6a00" : band === "BLOCK" ? "#b3261e" : "#66665f";
  const text = band ? `${band}${score !== null ? ` ${Math.round(score)}` : ""}` : "UNKNOWN";
  const w = 74 + text.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="fiangshi: ${esc(text)}"><rect width="70" height="20" fill="#333"/><rect x="70" width="${w - 70}" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,sans-serif" font-size="11"><text x="8" y="14">fiangshi</text><text x="78" y="14">${esc(text)}</text></g></svg>`;
}
