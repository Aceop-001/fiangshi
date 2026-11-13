/**
 * Animated "working model" figures for the Architecture page. Inline SVG animated with SMIL and CSS only: no script,
 * no image files, nothing loaded from anywhere (the page CSP stays default-src 'none'). Each figure loops and shows a
 * real path through the code; every value drawn is one the code produces (see docs/ARCHITECTURE.md for the sources).
 * Figure 1 replays three real lab cases (fixtures/lab). The numbers in figures 3 and 4 (scores, ages, hashes) are
 * examples, and the captions say so. With prefers-reduced-motion the moving parts are hidden and a labelled still shows.
 */

const FG = "#f2f2f2";
const MUT = "#9c9c9c";
const DIM = "#3d3d3d";
const RED = "#e5191c";
const REDT = "#ff4b41";
const GREY = "#8a8a8a";
const MONO = `font-family="ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace"`;
const SERIF = `font-family="'Times New Roman',Times,serif"`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f = (n: number) => Number(n.toFixed(4)).toString();

/** opacity window: hidden, then shown from a to b (fractions of the loop), then hidden. */
function show(a: number, b: number, dur: number): string {
  const e = 0.012;
  return `<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${f(Math.max(0.0001, a - e))};${f(a)};${f(b)};${f(Math.min(0.9999, b + e))};1" dur="${dur}s" repeatCount="indefinite"/>`;
}

/** The status mark the site uses: circle ALLOW, triangle REVIEW, square BLOCK. */
function mark(band: "ALLOW" | "REVIEW" | "BLOCK", x: number, y: number, s = 10): string {
  if (band === "ALLOW") return `<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${FG}"/>`;
  if (band === "REVIEW") return `<path d="M${x} ${y - s / 2} L${x + s / 2} ${y + s / 2} L${x - s / 2} ${y + s / 2} Z" fill="${GREY}"/>`;
  return `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" fill="${RED}"/>`;
}

function stamp(band: "ALLOW" | "REVIEW" | "BLOCK", x: number, y: number, label: string): string {
  const col = band === "BLOCK" ? RED : band === "REVIEW" ? GREY : FG;
  const w = 32 + label.length * 8.6;
  return `<rect x="${x}" y="${y - 13}" width="${f(w)}" height="26" fill="#000" stroke="${col}" stroke-width="1.5"/>${mark(band, x + 13, y)}<text x="${x + 24}" y="${y + 4.5}" fill="${col}" font-size="12" font-weight="700" letter-spacing="1.2" ${MONO}>${esc(label)}</text>`;
}

/* ---------------------------------------------------------------- 1. three checks, side by side ------------------ */

const STATIONS = ["Probe", "Gate", "Signals", "Score", "Model", "Vows", "Decide", "Receipt"];

function checksFigure(): string {
  const dur = 11;
  const x0 = 70;
  const step = 88;
  const xs = STATIONS.map((_, i) => x0 + i * step);
  const lanes: { y: number; title: string; stop: number; tEnd: number; band: "ALLOW" | "REVIEW" | "BLOCK"; label: string; why: string }[] = [
    { y: 112, title: "api.cleave.fi/x402/gas · payTo 0x0000…0000", stop: 1, tEnd: 0.2, band: "BLOCK", label: "BLOCK · $0.00", why: "rule I (null payee) at probe time: no data call, no model call, receipt still sealed" },
    { y: 212, title: "lab control C3 · mature wallet, many repeat payers", stop: 7, tEnd: 0.78, band: "ALLOW", label: "ALLOW · 86", why: "score 86.43, SERV agrees and its quotes match the evidence, no rule fires" },
    { y: 312, title: "lab case B6 · a required signal is missing", stop: 5, tEnd: 0.6, band: "REVIEW", label: "REVIEW", why: "rule VI (silence): a required signal is missing, so it fails closed" },
  ];
  const t0 = 0.04;
  let out = "";
  // station columns
  out += xs.map((x, i) => `<line x1="${x}" y1="58" x2="${x}" y2="${lanes[2]!.y + 18}" stroke="${DIM}" stroke-dasharray="2 5"/><text x="${x}" y="46" text-anchor="middle" fill="${MUT}" font-size="11.5" letter-spacing="1" ${MONO}>${i + 1} ${STATIONS[i]!.toUpperCase()}</text>`).join("");
  for (const L of lanes) {
    const end = xs[L.stop]!;
    const col = L.band === "BLOCK" ? RED : L.band === "REVIEW" ? GREY : FG;
    out += `<text x="${x0 - 22}" y="${L.y - 26}" fill="${FG}" font-size="12.5" ${MONO}>${esc(L.title)}</text>`;
    out += `<line x1="${x0 - 22}" y1="${L.y}" x2="${xs[7]! + 22}" y2="${L.y}" stroke="${DIM}" stroke-width="1.5"/>`;
    // the travelled part of the track lights up behind the token
    out += `<line x1="${x0}" y1="${L.y}" x2="${x0}" y2="${L.y}" stroke="${col}" stroke-width="2.5" class="fx-track"><animate attributeName="x2" values="${x0};${x0};${end};${end}" keyTimes="0;${t0};${f(L.tEnd)};1" dur="${dur}s" repeatCount="indefinite"/></line>`;
    // station dots: lit when the token reaches them; dim beyond the stop
    xs.forEach((x, i) => {
      if (i > L.stop) {
        out += `<circle cx="${x}" cy="${L.y}" r="4.5" fill="#000" stroke="${DIM}" stroke-width="1.5"/>`;
        return;
      }
      const ti = t0 + ((L.tEnd - t0) * i) / Math.max(1, L.stop);
      const lit = i === L.stop ? col : FG;
      out += `<circle cx="${x}" cy="${L.y}" r="5" fill="#000" stroke="${MUT}" stroke-width="1.5"><animate attributeName="fill" values="#000;#000;${lit};${lit};#000" keyTimes="0;${f(Math.max(0.0001, ti - 0.001))};${f(ti)};0.97;1" dur="${dur}s" repeatCount="indefinite"/></circle>`;
    });
    // the moving request
    out += `<g class="fx-move"><circle r="8" cy="${L.y}" cx="${x0}" fill="${col}" opacity=".25"><animate attributeName="cx" values="${x0};${x0};${end};${end}" keyTimes="0;${t0};${f(L.tEnd)};1" dur="${dur}s" repeatCount="indefinite"/></circle><circle r="4" cy="${L.y}" cx="${x0}" fill="${col}"><animate attributeName="cx" values="${x0};${x0};${end};${end}" keyTimes="0;${t0};${f(L.tEnd)};1" dur="${dur}s" repeatCount="indefinite"/></circle></g>`;
    // the verdict and why
    const sx = L.stop === 7 ? xs[7]! - 124 : end + 18;
    const sy = L.stop === 7 ? L.y - 26 : L.y;
    out += `<g class="fx-end" opacity="0">${show(L.tEnd + 0.02, 0.96, dur)}${stamp(L.band, sx, sy, L.label)}</g>`;
    out += `<text x="${x0 - 22}" y="${L.y + 30}" fill="${MUT}" font-size="11.5" ${MONO} class="fx-why">${esc(L.why)}${show(L.tEnd + 0.02, 0.96, dur)}</text>`;
  }
  return svg(760, 360, "Three checks running side by side through the eight steps", out);
}

/* ---------------------------------------------------------------- 2. who talks to whom ---------------------------- */

function box(x: number, y: number, w: number, h: number, title: string, sub: string, hot = false): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000" stroke="${hot ? RED : FG}" stroke-width="${hot ? 2 : 1.2}"/><text x="${x + w / 2}" y="${y + h / 2 - 3}" text-anchor="middle" fill="${FG}" font-size="${hot ? 19 : 16}" ${SERIF}>${esc(title)}</text><text x="${x + w / 2}" y="${y + h / 2 + 15}" text-anchor="middle" fill="${MUT}" font-size="10.5" letter-spacing=".8" ${MONO}>${esc(sub)}</text>`;
}

function packet(path: string, a: number, b: number, colour: string, dur: number, label?: string, lx?: number, ly?: number): string {
  const motion = `<animateMotion dur="${dur}s" repeatCount="indefinite" path="${path}" keyPoints="0;0;1;1" keyTimes="0;${f(a)};${f(b)};1" calcMode="linear"/>`;
  const dot = `<g class="fx-move" opacity="0">${show(a, b, dur)}<circle r="9" fill="${colour}" opacity=".25">${motion}</circle><circle r="4.5" fill="${colour}">${motion}</circle></g>`;
  const tag = label ? `<text x="${lx}" y="${ly}" text-anchor="middle" fill="${colour}" font-size="11" ${MONO} opacity="0" class="fx-tag">${show(a, b + 0.03, dur)}${esc(label)}</text>` : "";
  return dot + tag;
}

function flowFigure(): string {
  const dur = 14;
  let out = "";
  // wires
  const wires: [string, string][] = [
    ["M160 190 L300 190", "agent-fiangshi"],
    ["M460 210 L600 285", "fiangshi-seller"],
    ["M460 170 L600 105", "fiangshi-surf"],
    ["M350 155 L295 90", "fiangshi-serv"],
    ["M410 155 L465 90", "fiangshi-dolphin"],
  ];
  out += wires.map(([d]) => `<path d="${d}" stroke="${DIM}" stroke-width="1.5" fill="none" stroke-dasharray="4 4"/>`).join("");
  // money path: agent wallet straight to the seller, around Fiangshi
  out += `<path d="M90 220 Q90 340 300 340 L590 340 Q670 340 670 318" stroke="${DIM}" stroke-width="1.5" fill="none"/>`;
  out += `<text x="380" y="362" text-anchor="middle" fill="${MUT}" font-size="11" ${MONO}>money: the agent's own wallet → the seller. It never passes through Fiangshi.</text>`;
  out += box(20, 160, 140, 60, "AI agent", "about to pay");
  out += box(300, 150, 160, 80, "Fiangshi", "advises only", true);
  out += box(600, 255, 140, 62, "Seller", "x402 endpoint");
  out += box(600, 72, 140, 62, "Surf", "Base on-chain data");
  out += box(225, 30, 140, 58, "SERV", "reasoning model");
  out += box(400, 30, 140, 58, "Dolphin", "names only");
  // the sequence
  const steps: [string, number, number, string, string?, number?, number?][] = [
    ["M160 190 L300 190", 0.02, 0.1, FG, "check this URL", 230, 180],
    ["M460 210 L600 285", 0.11, 0.19, FG, "unpaid GET", 540, 235],
    ["M600 285 L460 210", 0.2, 0.28, FG, "402 + terms", 540, 268],
    ["M460 170 L600 105", 0.29, 0.36, FG, "SQL", 520, 128],
    ["M600 105 L460 170", 0.37, 0.44, FG, "wallet facts", 545, 158],
    ["M350 155 L295 90", 0.45, 0.52, FG],
    ["M410 155 L465 90", 0.45, 0.52, FG],
    ["M295 90 L350 155", 0.53, 0.6, FG, "advice, quotes checked", 380, 118],
    ["M465 90 L410 155", 0.53, 0.6, FG],
    ["M300 190 L160 190", 0.62, 0.71, FG, "ALLOW + receipt", 230, 210],
  ];
  out += steps.map((s) => packet(s[0], s[1], s[2], s[3], dur, s[4], s[5], s[6])).join("");
  // the payment, only after the verdict
  out += `<g class="fx-move" opacity="0">${show(0.74, 0.9, dur)}<g><animateMotion dur="${dur}s" repeatCount="indefinite" path="M90 220 Q90 340 300 340 L590 340 Q670 340 670 318" keyPoints="0;0;1;1" keyTimes="0;0.74;0.9;1" calcMode="linear"/><circle r="10" fill="${RED}"/><text y="4" text-anchor="middle" fill="#000" font-size="11" font-weight="700" ${MONO}>$</text></g></g>`;
  // Fiangshi works inside: three ticks while waiting on the others
  out += `<g opacity="0" class="fx-end">${show(0.62, 0.97, dur)}${mark("ALLOW", 330, 216, 9)}<text x="342" y="220" fill="${FG}" font-size="10.5" letter-spacing=".8" ${MONO}>VERDICT SEALED</text></g>`;
  // narration
  const lines: [number, number, string][] = [
    [0.0, 0.11, "1 · The agent asks Fiangshi about a paid URL before paying."],
    [0.11, 0.29, "2 · Fiangshi makes one unpaid request and reads the 402 payment terms."],
    [0.29, 0.45, "3 · It looks up the wallet that would be paid: age, funder, payers."],
    [0.45, 0.62, "4 · SERV advises; every quote must match the stored evidence. Dolphin reads names."],
    [0.62, 0.74, "5 · The rules decide. The verdict and a hash-chained receipt go back."],
    [0.74, 0.98, "6 · Only on ALLOW does the agent pay, from its own wallet."],
  ];
  out += lines.map(([a, b, t]) => `<text x="380" y="396" text-anchor="middle" fill="${FG}" font-size="13" ${MONO} opacity="0" class="fx-tag">${show(a + 0.001, b, dur)}${esc(t)}</text>`).join("");
  out += `<text x="380" y="396" text-anchor="middle" fill="${FG}" font-size="13" ${MONO} class="fx-static">Agent → Fiangshi → seller, Surf, SERV, Dolphin → verdict → the agent pays, or not.</text>`;
  return svg(760, 410, "Who Fiangshi talks to during one check, and where the money goes", out);
}

/* ---------------------------------------------------------------- 3. lowest band wins ----------------------------- */

function decideFigure(): string {
  const dur = 13.5;
  const cases: { a: number; b: number; title: string; score: [string, "ALLOW" | "REVIEW" | "BLOCK"]; model: [string, "ALLOW" | "REVIEW" | "BLOCK"]; rule: [string, "ALLOW" | "REVIEW" | "BLOCK"]; final: "ALLOW" | "REVIEW" | "BLOCK"; why: string }[] = [
    { a: 0.0, b: 0.32, title: "Case 1 · everything agrees", score: ["86 → ALLOW", "ALLOW"], model: ["SERV: ALLOW", "ALLOW"], rule: ["no rule fired", "ALLOW"], final: "ALLOW", why: "ALLOW needs all three." },
    { a: 0.33, b: 0.65, title: "Case 2 · a rule beats the model", score: ["84 → ALLOW", "ALLOW"], model: ["SERV: ALLOW", "ALLOW"], rule: ["age: 31 h old", "BLOCK"], final: "BLOCK", why: "The wallet is under 48 hours old. The model cannot overrule it." },
    { a: 0.66, b: 0.99, title: "Case 3 · the model alone cannot block", score: ["81 → ALLOW", "ALLOW"], model: ["SERV: BLOCK → REVIEW", "REVIEW"], rule: ["no rule fired", "ALLOW"], final: "REVIEW", why: "A model BLOCK is capped at REVIEW: it is not a machine-checkable reason." },
  ];
  const cols = [
    { x: 20, h: "SCORE BAND" },
    { x: 215, h: "MODEL BAND" },
    { x: 410, h: "RULE BAND" },
  ];
  let out = cols.map((c) => `<text x="${c.x}" y="70" fill="${MUT}" font-size="11.5" letter-spacing="1.4" ${MONO}>${c.h}</text><rect x="${c.x}" y="82" width="182" height="56" fill="none" stroke="${DIM}"/>`).join("");
  out += `<text x="677" y="70" text-anchor="middle" fill="${REDT}" font-size="11.5" letter-spacing="1.4" ${MONO}>FINAL = LOWEST</text><rect x="616" y="82" width="124" height="56" fill="none" stroke="${RED}" stroke-width="1.5"/>`;
  out += `<text x="604" y="116" text-anchor="middle" fill="${MUT}" font-size="15" ${MONO}>→</text>`;
  for (const c of cases) {
    const g = (x: number, [t, band]: [string, "ALLOW" | "REVIEW" | "BLOCK"]) => `${mark(band, x + 18, 110, 11)}<text x="${x + 34}" y="114.5" fill="${band === "BLOCK" ? REDT : band === "REVIEW" ? GREY : FG}" font-size="12" ${MONO}>${esc(t)}</text>`;
    out += `<g opacity="0" class="fx-case">${show(c.a + 0.01, c.b, dur)}<text x="20" y="34" fill="${FG}" font-size="19" ${SERIF}>${esc(c.title)}</text>${g(20, c.score)}${g(215, c.model)}${g(410, c.rule)}<g opacity="0">${show(c.a + 0.1, c.b, dur)}${mark(c.final, 636, 110, 13)}<text x="652" y="115" fill="${c.final === "BLOCK" ? REDT : c.final === "REVIEW" ? GREY : FG}" font-size="14" font-weight="700" letter-spacing="1.2" ${MONO}>${c.final}</text><text x="20" y="172" fill="${MUT}" font-size="12.5" ${MONO}>${esc(c.why)}</text></g></g>`;
  }
  out += `<g class="fx-static"><text x="20" y="34" fill="${FG}" font-size="19" ${SERIF}>A rule beats the model</text>${mark("ALLOW", 38, 110, 11)}<text x="54" y="114.5" fill="${FG}" font-size="12" ${MONO}>84 → ALLOW</text>${mark("ALLOW", 233, 110, 11)}<text x="249" y="114.5" fill="${FG}" font-size="12" ${MONO}>SERV: ALLOW</text>${mark("BLOCK", 428, 110, 11)}<text x="444" y="114.5" fill="${REDT}" font-size="12" ${MONO}>age: 31 h old</text>${mark("BLOCK", 636, 110, 13)}<text x="652" y="115" fill="${REDT}" font-size="14" font-weight="700" ${MONO}>BLOCK</text></g>`;
  return svg(760, 190, "How the final band is chosen: the lowest of the score, the model and the rules", out);
}

/* ---------------------------------------------------------------- 4. the receipt chain ---------------------------- */

function chainFigure(): string {
  const dur = 12;
  const xs = [30, 215, 400, 585];
  const hashes = ["9f3a…c1", "4be0…77", "d21c…08", "7a95…e3"];
  const bands = ["ALLOW", "BLOCK", "REVIEW", "ALLOW"];
  let out = "";
  xs.forEach((x, i) => {
    out += `<rect x="${x}" y="40" width="150" height="112" fill="#000" stroke="${FG}" stroke-width="1.2"/>`;
    out += `<text x="${x + 12}" y="62" fill="${MUT}" font-size="10.5" letter-spacing="1" ${MONO}>RECEIPT ${i + 1}</text>`;
    out += `<text x="${x + 12}" y="84" fill="${FG}" font-size="11.5" ${MONO}>prev ${i ? hashes[i - 1] : "0000…00"}</text>`;
    out += `<text x="${x + 12}" y="104" fill="${FG}" font-size="11.5" ${MONO}>band ${i === 2 ? "" : bands[i]}</text>`;
    out += `<text x="${x + 12}" y="132" fill="${FG}" font-size="11.5" ${MONO}>hash ${hashes[i]}</text>`;
    if (i < 3) out += `<path d="M${x + 150} 128 L${x + 185} 128 L${x + 185} 80 L${x + 192} 80" fill="none" stroke="${FG}" stroke-width="1.2" class="fx-link${i === 2 ? " fx-break" : ""}">${i === 2 ? `<animate attributeName="stroke" values="${FG};${FG};${RED};${RED};${FG}" keyTimes="0;0.62;0.63;0.97;1" dur="${dur}s" repeatCount="indefinite"/><animate attributeName="stroke-dasharray" values="none;none;3 4;3 4;none" keyTimes="0;0.62;0.63;0.97;1" dur="${dur}s" repeatCount="indefinite"/>` : ""}</path>`;
  });
  // receipt 3's band: REVIEW, then someone edits it to ALLOW
  const bx = xs[2]! + 12 + 5 * 7;
  out += `<text x="${bx}" y="104" fill="${FG}" font-size="11.5" ${MONO}>REVIEW<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.45;0.46;0.97;1" dur="${dur}s" repeatCount="indefinite"/></text>`;
  out += `<text x="${bx}" y="104" fill="${REDT}" font-size="11.5" font-weight="700" ${MONO} opacity="0">ALLOW ✎${show(0.46, 0.97, dur)}</text>`;
  // the verifier sweeps across twice
  for (const [a, b] of [[0.04, 0.38], [0.5, 0.86]] as const)
    out += `<rect class="fx-move" x="20" y="34" width="6" height="124" fill="${FG}" opacity="0">${show(a, b, dur)}<animate attributeName="x" values="20;20;740;740" keyTimes="0;${a};${b};1" dur="${dur}s" repeatCount="indefinite"/></rect>`;
  // results under each receipt
  xs.forEach((x, i) => {
    out += `<text x="${x + 75}" y="178" text-anchor="middle" fill="${FG}" font-size="12" ${MONO} opacity="0">${show(0.04 + (0.34 * (x + 75)) / 720, 0.44, dur)}✓ valid</text>`;
    const after = i < 2 ? "✓ valid" : i === 2 ? "✗ hash mismatch" : "✗ link broken";
    out += `<text x="${x + 75}" y="178" text-anchor="middle" fill="${i < 2 ? FG : REDT}" font-size="12" ${MONO} opacity="0">${show(0.5 + (0.36 * (x + 75)) / 720, 0.97, dur)}${after}</text>`;
  });
  out += `<text x="30" y="212" fill="${MUT}" font-size="12" ${MONO} opacity="0" class="fx-tag">${show(0.04, 0.44, dur)}GET /v1/verify recomputes every sha256 and every link: valid.</text>`;
  out += `<text x="30" y="212" fill="${REDT}" font-size="12" ${MONO} opacity="0" class="fx-tag">${show(0.46, 0.97, dur)}One word changed in receipt 3: its hash no longer matches, and the chain breaks after it.</text>`;
  out += `<text x="30" y="212" fill="${MUT}" font-size="12" ${MONO} class="fx-static">Each receipt carries the hash of the one before. Change one word and verify fails from there on.</text>`;
  return svg(760, 225, "The receipt chain: verifying, then catching an edited receipt", out);
}

/* ---------------------------------------------------------------- shell ------------------------------------------- */

function svg(w: number, h: number, label: string, inner: string): string {
  return `<svg class="fx" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

export const FIGURES: Record<string, { title: string; svg: () => string; caption: string }> = {
  "one check, live": {
    title: "Three checks, live",
    svg: checksFigure,
    caption:
      "Three requests go through the same eight steps. A dead-end payment address stops at step 2, for free. A strong seller goes all the way to ALLOW. A seller with missing data stops at the rules and gets REVIEW, because Fiangshi never guesses.",
  },
  "who talks to whom": {
    title: "Who talks to whom, and where the money goes",
    svg: flowFigure,
    caption:
      "Fiangshi sits beside the payment, not in it. It reads the seller's terms, the wallet's on-chain history and a model's advice, then answers. The money goes from the agent's own wallet to the seller, never through Fiangshi.",
  },
  "lowest band wins": {
    title: "The lowest band wins",
    svg: decideFigure,
    caption:
      "The score, the model and the rules each give a band, and the final verdict is the lowest of the three. A rule can overrule the model. A model on its own can lower a verdict to REVIEW, never to BLOCK, and never raise one. The numbers shown are examples.",
  },
  "the receipt chain": {
    title: "The receipt chain catches an edit",
    svg: chainFigure,
    caption:
      "Every receipt holds the hash of the receipt before it. Verify recomputes them all. Edit one word in one receipt and its hash stops matching, and every link after it breaks. The hashes shown are shortened examples.",
  },
};

/** The figure block for the page: an animated SVG that scrolls sideways on narrow screens, with a plain caption. */
export function figureHtml(key: string, n: number): string | null {
  const fig = FIGURES[key];
  if (!fig) return null;
  return `<figure class="fxfig"><figcaption><span class="eyebrow">Figure ${n} · live model</span><b>${esc(fig.title)}</b></figcaption><div class="fxwrap">${fig.svg()}</div><p>${esc(fig.caption)}</p></figure>`;
}

export const FIGURE_CSS = `
.fxfig{margin:22px 0 30px;border:1px solid var(--line2);padding:16px 16px 14px;background:#000}
.fxfig figcaption{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
.fxfig figcaption .eyebrow{color:var(--red-text)}
.fxfig figcaption b{font:400 21px/1.2 var(--serif)}
.fxwrap{overflow-x:auto}
.fx{display:block;width:100%;min-width:620px;height:auto}
.fxfig>p{margin-top:10px;color:var(--mut);font-size:13px}
.fx .fx-static{display:none}
@media(prefers-reduced-motion:reduce){
.fx .fx-move,.fx .fx-tag,.fx .fx-case{display:none}
.fx .fx-static{display:inline}
.fx .fx-end,.fx .fx-why{opacity:1!important}
}
`;
