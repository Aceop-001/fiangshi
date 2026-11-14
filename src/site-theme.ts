/**
 * Shared look of the HTML pages: tokens, the Fiangshi mark, the "?" rain and the page shell.
 * Static by construction: no script, no framework, no external request (system fonts, inline SVG, inline CSS).
 * The Content-Security-Policy below forbids scripts outright, so "no JS" is enforced by the browser, not by convention.
 */
import { liveApi, providerMode, staticSite } from "./config.js";
import { DOC_PAGES } from "./docs-index.js";
import { LANGS, lang, t as T } from "./i18n.js";

/** The page path without its language prefix, set by the server per request (for the language switcher). */
let pagePath = "/";
export const setPagePath = (p: string) => void (pagePath = p);

export const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const short = (a: string, head = 10, tail = 4) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);
export const usd = (x: number | null | undefined) => (x === null || x === undefined ? "unknown" : `$${x < 0.01 ? x.toFixed(3) : x.toFixed(2)}`);
export const bareUrl = (u: string) => u.replace(/^https?:\/\//i, "");

const RED = "#e5191c";
const NUMERALS = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

/**
 * The Fiangshi mark, redrawn from the logo as SVG: red roman numerals set radially on a black dial, and the name
 * in Chinese (菲昂诗) at the centre. `bezel` adds the minute ticks and the stepping seconds marker used in the hero (decoration only).
 */
export function logoSvg(o: { bezel?: boolean; label?: string } = {}): string {
  const numerals = NUMERALS.map((n, i) => `<text transform="rotate(${i * 30} 200 200) translate(200 42) scale(.84 1)">${n}</text>`).join("");
  const ticks = o.bezel
    ? `<g stroke="#f2f2f2">${Array.from({ length: 60 }, (_, k) => `<line x1="200" y1="${k % 5 ? 5 : 2}" x2="200" y2="9" stroke-opacity="${k % 5 ? 0.35 : 0.8}" transform="rotate(${k * 6} 200 200)"/>`).join("")}</g><rect class="sec" x="198.5" y="0" width="3" height="11" fill="${RED}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="${esc(o.label ?? "Fiangshi")}"><circle cx="200" cy="200" r="${o.bezel ? 188 : 200}" fill="#000"/>${ticks}<g fill="${RED}" font-family="'Times New Roman',Times,serif" font-size="39" text-anchor="middle">${numerals}</g><g fill="#fff" font-family="'Songti SC','Noto Serif CJK SC','Source Han Serif SC','Noto Serif SC',SimSun,serif" font-size="62" text-anchor="middle" lang="zh-Hans"><text x="200" y="190" letter-spacing="10">菲昂</text><text x="200" y="262">诗</text></g></svg>`;
}

const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#000"/><g stroke="${RED}" stroke-width="3">${Array.from({ length: 12 }, (_, k) => `<line x1="32" y1="5" x2="32" y2="13" transform="rotate(${k * 30} 32 32)"/>`).join("")}</g><text x="32" y="43" font-family="'Times New Roman',Times,serif" font-size="32" fill="#fff" text-anchor="middle">F</text></svg>`,
)}`;

/** One seamless tile of falling red "?" streams (deterministic, so the page is byte-stable for a given census). */
function rainTile(seed: number, w: number, h: number, colW: number, minSize: number, maxSize: number): string {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let out = "";
  for (let x = colW / 2; x < w; x += colW) {
    const streams = rnd() < 0.5 ? 1 : 2;
    for (let k = 0; k < streams; k++) {
      const len = 4 + Math.floor(rnd() * 9);
      const size = Math.round(minSize + rnd() * rnd() * (maxSize - minSize));
      const head = Math.floor(rnd() * h);
      for (let j = 0; j < len; j++) {
        const y = head - j * (size + 3);
        const op = Math.max(0.08, (1 - j / len) ** 1.7 * (0.45 + rnd() * 0.55)).toFixed(2);
        // draw the glyph where it lands and again one tile away, so streams wrap across the tile edge
        for (const yy of [y, y + h, y - h]) if (yy > -maxSize && yy < h + maxSize) out += `<text x='${x}' y='${yy}' font-size='${size}' fill-opacity='${op}'>?</text>`;
      }
    }
  }
  // single-quoted attributes + the three characters a CSS url("…") data URI cannot carry raw
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><g fill='${RED}' font-family='Georgia,Times,serif' font-weight='700' text-anchor='middle'>${out}</g></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
}

/** Hero-only styles (the rain tiles are ~25 kB, so pages without a hero do not carry them). */
export const HERO_CSS = `
.rain{position:absolute;inset:0;overflow:hidden;pointer-events:none;-webkit-mask-image:linear-gradient(transparent,#000 14%,#000 62%,transparent);mask-image:linear-gradient(transparent,#000 14%,#000 62%,transparent)}
.rain::before,.rain::after{content:"";position:absolute;left:0;right:0;top:-480px;bottom:0}
.rain::before{background:${rainTile(7, 340, 480, 20, 9, 15)} 0 0/340px 480px;opacity:.5;animation:fall 46s linear infinite}
.rain::after{background:${rainTile(1923, 390, 480, 26, 13, 30)} 0 0/390px 480px;opacity:.9;animation:fall 27s linear infinite}
@keyframes fall{to{transform:translateY(480px)}}
/* first-visit tour: radio steps, no script */
.tour{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.84);display:grid;place-items:center;padding:16px;overflow-y:auto}
.tour-r{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
.tour-card{position:relative;width:min(560px,100%);border:1px solid var(--hud);background:var(--bg);padding:26px 24px 20px}
.tour-card::before{content:"";position:absolute;inset:-4px;pointer-events:none;background:linear-gradient(var(--red),var(--red)) 0 0/7px 7px no-repeat,linear-gradient(var(--red),var(--red)) 100% 0/7px 7px no-repeat,linear-gradient(var(--red),var(--red)) 0 100%/7px 7px no-repeat,linear-gradient(var(--red),var(--red)) 100% 100%/7px 7px no-repeat}
.tour-r:focus-visible~.tour-card{outline:2px solid var(--fg);outline-offset:6px}
.tour-s{display:none}
#ts1:checked~.tour-card .s1,#ts2:checked~.tour-card .s2,#ts3:checked~.tour-card .s3,#ts4:checked~.tour-card .s4,#ts5:checked~.tour-card .s5{display:block}
.tour-s h2{font-size:clamp(24px,4.4vw,34px);line-height:1.1;margin:10px 0 12px;padding-right:24px}
.tour-s>p:not(.eyebrow){color:#d6d6d6;max-width:52ch}
.tour-bands{display:grid;gap:10px;margin-top:16px}
.tour-bands li{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px;align-items:baseline;color:#d6d6d6}
.tour-nav{display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;margin-top:24px}
.tour-dots{display:flex;gap:6px;margin:0 auto}
.tour-dots label{width:9px;height:9px;border:1px solid var(--mut);cursor:pointer}
#ts1:checked~.tour-card .d1,#ts2:checked~.tour-card .d2,#ts3:checked~.tour-card .d3,#ts4:checked~.tour-card .d4,#ts5:checked~.tour-card .d5{background:var(--red);border-color:var(--red)}
.tour-f{background:var(--fg);color:#000;border:0;padding:9px 16px;font:600 12px var(--mono);letter-spacing:.18em;text-transform:uppercase;cursor:pointer;text-decoration:none}
.tour-f:hover{color:#000;background:#fff}
.tour-b{color:var(--mut);font-size:12px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
.tour-x{position:absolute;top:6px;right:12px;font:24px/1 var(--serif);text-decoration:none;color:var(--mut);padding:4px}
@media(max-width:600px){.tour-card{padding:22px 16px 16px}.tour-bands li{grid-template-columns:minmax(0,1fr);gap:4px}.tour-nav .tour-f{flex:1 1 100%;text-align:center}.tour-dots{order:-1;flex:1 1 100%;justify-content:center}}
`;

const CSS = `
:root{color-scheme:dark;--bg:#000;--fg:#f2f2f2;--mut:#9c9c9c;--dim:#8a8a8a;--line:#242424;--line2:#3d3d3d;--hud:rgba(242,242,242,.8);
--red:${RED};--red-text:#ff4b41;--allow:#f2f2f2;--review:#8a8a8a;--block:${RED};
--paper:#f1ede4;--ink:#111;--ink2:#5a564e;--paper-red:#b3120f;
--serif:"Times New Roman",Times,"Liberation Serif",Georgia,serif;
--mono:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,"Liberation Mono",monospace}
*{box-sizing:border-box}
html{background:var(--bg);scroll-behavior:smooth;scrollbar-color:#3d3d3d #000;overflow-x:clip}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 var(--mono);-webkit-text-size-adjust:100%;overflow-x:clip}
h1,h2,h3,p,ol,ul,dl,dd,figure{margin:0}
ol,ul{padding:0;list-style:none}
h1,h2{font-family:var(--serif);font-weight:400;letter-spacing:.01em;text-wrap:balance}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{color:var(--red-text)}
:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
code{font-family:var(--mono)}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.mut{color:var(--mut)}
.scroll{overflow-x:auto}

/* status: fill + shape + label, never colour alone (circle / triangle / square) */
.ALLOW{--c:var(--allow)}.REVIEW{--c:var(--review)}.BLOCK{--c:var(--block)}.NONE{--c:var(--dim)}
.st{display:inline-block;flex:none;width:10px;height:10px;margin-right:8px;background:var(--c)}
.st.ALLOW{border-radius:50%}.st.REVIEW{clip-path:polygon(50% 0,100% 100%,0 100%)}
.chip{display:inline-flex;align-items:center;border:1px solid var(--line2);padding:2px 8px 2px 7px;font:600 11px/1.5 var(--mono);letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;vertical-align:middle}
.chip .st{width:8px;height:8px;margin-right:6px}

/* top bar */
.bar{border-bottom:1px solid var(--line2);font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.bar-in{display:flex;flex-wrap:wrap;align-items:center;gap:8px 22px;padding-top:11px;padding-bottom:11px}
.brand{font:400 17px/1 var(--serif);letter-spacing:.34em;color:var(--fg);text-decoration:none;margin-right:auto}
.bar nav{display:flex;flex-wrap:wrap;gap:4px 16px}
.bar nav a{text-decoration:none}
.state{display:flex;align-items:baseline;gap:8px;min-width:0}
.pulse{flex:none;width:7px;height:7px;border-radius:50%;background:var(--red);animation:pulse 1.8s ease-in-out infinite}
.pulse.off{background:none;border:1px solid var(--mut);animation:none}
@keyframes pulse{50%{opacity:.2}}
.modebar{background:var(--fg);color:#000;font-size:12.5px}
.modebar p{padding:8px 0}

/* HUD panel: hairline frame with corner marks */
.hud{position:relative;border:1px solid var(--hud);background:var(--bg)}
.hud::before{content:"";position:absolute;inset:-4px;pointer-events:none;background:
linear-gradient(var(--fg),var(--fg)) 0 0/7px 7px no-repeat,linear-gradient(var(--fg),var(--fg)) 100% 0/7px 7px no-repeat,
linear-gradient(var(--fg),var(--fg)) 0 100%/7px 7px no-repeat,linear-gradient(var(--fg),var(--fg)) 100% 100%/7px 7px no-repeat}
.hud-h{display:flex;justify-content:space-between;gap:12px;padding:8px 14px;border-bottom:1px solid var(--hud);font-size:11.5px;letter-spacing:.18em;text-transform:uppercase}
.hud-h span:last-child{color:var(--mut);text-align:right}
.hud-b{padding:20px 18px}

/* hero */
.hero{position:relative;border-bottom:1px solid var(--line2)}
.hero-in{position:relative;display:grid;grid-template-columns:minmax(0,760px);justify-content:center;padding-top:72px;padding-bottom:80px}
@keyframes sweep{to{transform:rotate(360deg)}}
.kicker{font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--red-text)}
h1{font-size:clamp(34px,5.2vw,58px);line-height:1.04;margin:10px 0 16px}
.hero .lede{max-width:60ch;color:#d6d6d6}
.probe{margin-top:22px}
.probe label{display:block;font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.probe-row{display:flex;border:1px solid var(--hud)}
.probe-row:focus-within{outline:2px solid var(--fg);outline-offset:2px}
.probe-row>span{padding:11px 0 11px 12px;color:var(--red-text)}
.age{display:flex;align-items:baseline;gap:2px;font-size:12.5px;color:var(--mut);margin:-6px 0 18px}
.age.stale{color:var(--fg)}
.agebadge{display:inline-flex;align-items:baseline;gap:4px;font-size:12.5px;color:var(--mut);margin-top:8px}
.agebadge.stale{color:var(--fg);font-weight:600}
.keep{margin-top:22px}.keep .kvs{margin-bottom:8px}
.vurl{display:block;width:100%;box-sizing:border-box;font:12px/1.45 var(--mono,monospace);color:inherit;background:transparent;border:1px solid var(--line,#444);padding:8px;resize:vertical;word-break:break-all}
.unknowns{margin-top:28px}
.caps{margin-top:26px;border:1px solid var(--line2);padding:16px 18px;max-width:84ch}
.caps h3{font:600 12.5px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--red-text);margin:0 0 8px}
.caps p{color:#d6d6d6}
.probe-l{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.probe-static .probe-row code{padding:11px 12px;overflow-x:auto;white-space:nowrap;color:var(--fg)}
.probe-static .mut{margin-top:10px;font-size:12.5px}
.probe input{flex:1;min-width:0;background:none;border:0;color:var(--fg);font:14px var(--mono);padding:11px 12px;outline:none}
.probe input::placeholder{color:#767676}
.probe button{background:var(--fg);color:#000;border:0;font:600 12px var(--mono);letter-spacing:.18em;text-transform:uppercase;padding:0 20px;cursor:pointer}
.probe button:hover{background:var(--red);color:#fff}
.try{margin-top:12px;font-size:12.5px;color:var(--mut)}



/* sections */
.sec{padding:64px 0 0}
.eyebrow{display:flex;align-items:center;gap:14px;font:600 11.5px/1 var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--red-text);margin-bottom:16px}
.eyebrow::after{content:"";flex:1;height:1px;background:var(--line2)}
h2{font-size:clamp(26px,3.6vw,38px);line-height:1.14;margin-bottom:12px}
.sec>.wrap>.lede{color:var(--mut);max-width:76ch;margin-bottom:26px}

/* census: stat tiles + thin segmented bar */
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line2)}
.tile{padding:16px 16px 18px;border-left:1px solid var(--line2);border-top:3px solid var(--c);min-width:0}
.tile:first-child{border-left:0}
.tile-l{display:flex;align-items:center;font:600 11.5px/1 var(--mono);letter-spacing:.18em}
.tile-v{font:600 clamp(38px,7vw,64px)/1 var(--mono);letter-spacing:-.02em;margin:12px 0 8px}
.tile-s{color:var(--mut);font-size:12.5px}
.seg{display:flex;gap:2px;height:8px;margin-top:14px}
.seg i{background:var(--c);min-width:2px}
.seg i:first-child{border-radius:4px 0 0 4px}.seg i:last-child{border-radius:0 4px 4px 0}

/* chart: stacked score histogram */
.chart{margin-top:34px}
.chart-sub{color:var(--mut);max-width:78ch}
.legend{display:flex;flex-wrap:wrap;gap:6px 20px;margin:14px 0 8px;font-size:12px;letter-spacing:.1em}
.legend span{display:inline-flex;align-items:center}
.plot-grid{display:grid;grid-template-columns:auto 1fr;column-gap:10px}
.zones{grid-column:2;display:flex;font-size:11px;line-height:1.35;color:var(--mut);margin-bottom:6px}
.zones span{padding-left:6px;border-left:1px dashed rgba(242,242,242,.55);min-width:0}
.zones b{display:block;color:var(--fg);font-weight:600}
.yax{position:relative;width:22px;height:190px;font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}
.yax span{position:absolute;right:0;transform:translateY(50%)}
.plot{position:relative;height:190px;border-bottom:1px solid var(--line2)}
.gl{position:absolute;left:0;right:0;height:1px;background:var(--line)}
.thr{position:absolute;top:0;bottom:0;border-left:1px dashed rgba(242,242,242,.55);pointer-events:none}
.bins{position:absolute;inset:0;display:flex}
.bin{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;padding:0 1px}
.bin:hover{background:rgba(255,255,255,.07)}
.bin:hover .col{filter:brightness(1.18)}
.bin .sp{min-height:0}
.col{display:flex;flex-direction:column;gap:2px;min-height:0;flex-basis:0;width:100%;max-width:24px;margin:0 auto;transform-origin:50% 100%;animation:grow .7s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i)*9ms)}
@keyframes grow{from{transform:scaleY(0)}}
.col i{background:var(--c);min-height:2px;flex-basis:0}
.col i:first-child{border-radius:4px 4px 0 0}
.tip{display:none;position:absolute;z-index:5;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:8px;white-space:nowrap;background:#000;border:1px solid var(--hud);padding:8px 10px;font-size:12px;line-height:1.55;pointer-events:none}
.bin.l .tip{left:0;transform:none}.bin.r .tip{left:auto;right:0;transform:none}
.bin:hover .tip{display:block}
.tip b{font-weight:600}.tip .st{width:8px;height:8px;margin-right:6px}
.xax{grid-column:2;position:relative;height:22px;font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}
.xax span{position:absolute;top:5px;transform:translateX(-50%)}
.xax span.on{color:var(--fg)}.xax span:first-child{transform:none}.xax span:last-child{transform:translateX(-100%)}
.xax-t{grid-column:2;text-align:center;font-size:11px;color:var(--dim);letter-spacing:.14em;text-transform:uppercase}
.insight{margin-top:16px;padding-left:12px;border-left:2px solid var(--red);max-width:78ch}
details.twin{margin-top:16px;font-size:12.5px}
details.twin summary{cursor:pointer;color:var(--mut);letter-spacing:.1em}

/* tables */
.tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.tbl th{font-weight:600;text-align:left;color:var(--mut);text-transform:uppercase;letter-spacing:.12em;font-size:11px;border-bottom:1px solid var(--line2);padding:8px 10px;white-space:nowrap}
.tbl td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tbl td small{display:block;font-size:inherit;color:var(--mut);overflow-wrap:anywhere}
.tbl td b{font-weight:600}
.tbl code{white-space:nowrap}
details.led .tbl{min-width:680px}
#funders .tbl{min-width:520px}
#api .tbl{min-width:560px}

/* case files: polaroids pinned to a red string */
.string-scroll{overflow-x:auto;overflow-y:hidden;margin:0 -16px;padding:6px 16px 26px}
.string{position:relative;min-width:960px}
.cord{position:absolute;left:0;top:0;width:100%;height:60px}
.cord path{fill:none;stroke:var(--red);stroke-width:2}
.pins{display:grid;grid-template-columns:repeat(5,1fr)}
.pins li{padding:0 11px;margin-top:calc(var(--y) - 7px);min-width:0}
.polaroid{display:block;position:relative;background:var(--paper);color:var(--ink);padding:10px 10px 12px;text-decoration:none;box-shadow:0 14px 34px rgba(0,0,0,.7);transform-origin:50% 0;transform:rotate(var(--r));animation:sway 7s ease-in-out infinite alternate;animation-delay:var(--d)}
@keyframes sway{to{transform:rotate(calc(var(--r)*-.45))}}
a.polaroid:hover,a.polaroid:focus-visible{animation:none;transform:rotate(0) translateY(3px);color:var(--ink)}
.peg{position:absolute;top:-10px;left:50%;width:13px;height:26px;margin-left:-6.5px;background:#c9c2b2;border:1px solid #6e685c;border-radius:2px;box-shadow:inset 0 -9px 0 #b3ab99}
.photo{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;aspect-ratio:5/6;background:#0a0a0a;color:var(--fg);padding:10px;overflow:hidden}
.ph-tag{font-size:10px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.stamp{align-self:center;font:400 21px/1 var(--serif);letter-spacing:.16em;padding:7px 7px 5px 11px;border:2px solid var(--c);color:var(--c);transform:rotate(-8deg)}
.ph-fig{font:600 22px/1.1 var(--mono);letter-spacing:-.01em}
.ph-fig small{display:block;font:400 10.5px/1.5 var(--mono);letter-spacing:.06em;color:var(--mut)}
.photo.blank{align-items:center;justify-content:center}
.photo.blank b{font:700 96px/1 Georgia,serif;color:var(--red);opacity:.5}
.cap{display:block;padding:11px 2px 0;min-height:76px}
.cap b{display:block;font:italic 400 16.5px/1.22 var(--serif);overflow-wrap:anywhere}
.cap small{display:block;margin-top:5px;font-size:10.5px;line-height:1.45;color:var(--ink2);overflow-wrap:anywhere}
.notes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 40px;margin-top:8px}
.notes li{display:grid;grid-template-columns:34px 1fr;min-width:0}
.notes .k{font:400 26px/1 var(--serif);color:var(--red)}
.notes h3{font:600 13px/1.5 var(--mono);margin-bottom:4px;overflow-wrap:anywhere}
.notes p{color:var(--mut)}

/* how a verdict is made: pipeline + vows */
.pipe{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border:1px solid var(--line2);margin-bottom:34px}
.pipe li{padding:14px 12px 16px;border-left:1px solid var(--line2);min-width:0}
.pipe li:first-child{border-left:0}
.pipe i{display:block;font:normal 11px/1 var(--mono);color:var(--red-text);letter-spacing:.14em;margin-bottom:10px}
.pipe b{display:block;font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:12px;margin-bottom:6px}
.pipe span{display:block;color:var(--mut);font-size:12.5px;line-height:1.5}
.vows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 40px}
.vows li{display:grid;grid-template-columns:62px 1fr;padding:18px 0;border-top:1px solid var(--line);min-width:0}
.vows .num{font:400 38px/1 var(--serif);color:var(--red)}
.vows h3{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font:600 14px/1.4 var(--mono);margin-bottom:6px}
.vows p{color:var(--mut)}
.vows .fired{margin-top:6px;font-size:12.5px;color:var(--fg)}

/* ledger */
details.led{border:1px solid var(--line2);margin-top:10px}
details.led>summary{display:flex;align-items:center;cursor:pointer;padding:13px 14px;list-style:none;font:600 12px/1 var(--mono);letter-spacing:.16em}
details.led>summary::-webkit-details-marker{display:none}
details.led>summary::after{content:"+";margin-left:auto;color:var(--mut);font-size:16px}
details.led[open]>summary::after{content:"\\2013"}
details.led>summary span{margin-left:12px;color:var(--mut);font-weight:400;letter-spacing:.06em}
details.led>.scroll{border-top:1px solid var(--line2);max-height:560px;overflow:auto}

/* check page */
.case{padding-top:44px}
.case h1{font-size:clamp(26px,4.2vw,44px);overflow-wrap:anywhere;margin:0 0 26px}
.verdict{display:grid;grid-template-columns:auto 1fr;gap:26px;align-items:center;border:1px solid var(--line2);border-left:4px solid var(--c);padding:22px 22px 22px 26px;margin-bottom:26px}
.verdict .stamp{font-size:34px;padding:11px 12px 8px 18px;transform:rotate(-6deg)}
.verdict h2{font:600 16px/1.45 var(--mono);letter-spacing:0;margin-bottom:6px}
.verdict>div{min-width:0}
.verdict p{color:var(--mut);max-width:70ch;overflow-wrap:anywhere}
.kvs{display:grid;gap:2px}
.kv{display:flex;align-items:baseline;gap:8px;padding:5px 0}
.kv dt{flex:none;color:var(--mut);text-transform:uppercase;letter-spacing:.12em;font-size:11.5px}
.kv i{flex:1;min-width:14px;border-bottom:1px dotted var(--line2);transform:translateY(-4px)}
.kv dd{text-align:right;overflow-wrap:anywhere;min-width:0}
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:26px;margin-top:26px}
.cols>*{min-width:0}
.quotes li{padding:9px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}
.quotes li:first-child{border-top:0;padding-top:0}
.quotes b{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);font-weight:600}
.cmd{display:block;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 12px;border:1px solid var(--line2);margin:8px 0 4px;font-size:12.5px}
.cmd::before{content:">> ";color:var(--red-text)}
.next li{padding:12px 0;border-top:1px solid var(--line)}
.next li:first-child{border-top:0;padding-top:0}
.again{margin-top:40px;max-width:720px}

/* receipt: a paper slip */
.rc-wrap{display:grid;grid-template-columns:minmax(0,440px) minmax(0,1fr);gap:44px;align-items:start;padding-top:44px}
.rc{position:relative;background:var(--paper);color:var(--ink);padding:24px 22px 26px;font-size:12.5px;line-height:1.55;margin-bottom:14px}
.rc::after{content:"";position:absolute;left:0;right:0;top:100%;height:7px;background:linear-gradient(135deg,var(--paper) 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(225deg,var(--paper) 25%,transparent 25%) -7px 0/14px 14px}
.rc-head{text-align:center;padding-bottom:14px}
.rc-head b{display:block;font:400 22px/1 var(--serif);letter-spacing:.34em;margin-left:.34em}
.rc-head span{display:block;margin-top:6px;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2)}
.rc hr{border:0;border-top:1px dashed #8d877a;margin:12px 0}
.rc .kv{padding:2px 0}
.rc .kv dt{color:var(--ink2);font-size:11px}
.rc .kv i{border-color:#b6b0a2}
.rc-band{display:flex;justify-content:space-between;align-items:center;gap:12px}
.rc-band .stamp{align-self:auto;font-size:26px;transform:rotate(-4deg);color:var(--k);border-color:var(--k)}
.rc-band.ALLOW{--k:var(--ink)}.rc-band.REVIEW{--k:var(--ink2)}.rc-band.BLOCK{--k:var(--paper-red)}
.rc-band div{text-align:right}
.rc-band b{display:block;font:600 24px/1.1 var(--mono)}
.rc-band small{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
.rc h3{font:600 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);margin-bottom:8px}
.rc .ev li{padding:3px 0;overflow-wrap:anywhere}
.rc .ev b{font-weight:600}
.rc .hash{overflow-wrap:anywhere;font-size:11.5px}
.rc .bars{display:block;width:100%;height:44px;margin-top:14px}
.rc .fine{text-align:center;margin-top:10px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
.proof .big{display:flex;align-items:flex-start;font:600 15px/1.4 var(--mono);margin-bottom:8px}
.proof .big .st{margin-top:5px}

/* documents: the guide and the legal page, rendered from Markdown */
.doc-wrap{display:grid;grid-template-columns:210px minmax(0,1fr);gap:56px;align-items:start;padding-top:44px}
.toc{position:sticky;top:20px;font-size:12.5px}
.toc ol{display:grid;gap:9px}
.toc a{color:var(--mut);text-decoration:none}
.toc a:hover{color:var(--fg)}
.doc{max-width:84ch;min-width:0}
.doc h1{font-size:clamp(34px,5vw,54px);margin:0 0 18px}
.doc h1+p{font-size:15.5px;color:var(--fg)}
.doc h2{font-size:clamp(24px,3vw,32px);margin:52px 0 16px;padding-top:20px;border-top:1px solid var(--line2)}
.doc h3{font:600 12.5px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--red-text);margin:30px 0 10px}
.doc h4{font:600 14px/1.4 var(--mono);margin:22px 0 8px}
.doc p{margin:0 0 14px;color:#d6d6d6}
.doc ul,.doc ol{margin:0 0 16px;padding-left:22px}
.doc ul{list-style:square}.doc ol{list-style:decimal}
.doc li{margin:0 0 7px;padding-left:4px;color:#d6d6d6}
.doc li::marker{color:var(--red-text)}
.doc strong{color:var(--fg);font-weight:600}
.doc code{background:#111;border:1px solid var(--line);padding:1px 5px;font-size:.92em;overflow-wrap:anywhere}
.doc pre{margin:0 0 18px;padding:14px 16px;border:1px solid var(--line2);overflow-x:auto;font-size:12.5px;line-height:1.55}
.doc pre code{background:none;border:0;padding:0;font-size:inherit;overflow-wrap:normal}
.doc blockquote{margin:0 0 18px;padding:2px 0 2px 14px;border-left:2px solid var(--red)}
.doc blockquote p{margin:0;color:var(--fg)}
.doc .scroll{margin:0 0 18px}
.doc pre,.scroll,.string-scroll{scrollbar-width:thin}
.doc .tbl td{color:#d6d6d6}
.contact{margin-top:44px;border:1px solid var(--hud);padding:16px 18px}
.contact h2{border:0;margin:0 0 8px;padding:0;font-size:22px}
.contact p{margin:0}

/* footer */
footer{margin-top:72px;border-top:1px solid var(--line2);color:var(--mut);font-size:12.5px}
.foot{display:flex;flex-wrap:wrap;gap:8px 30px;padding-top:18px;padding-bottom:32px}
.foot p{max-width:86ch}
.foot-links{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px 20px;letter-spacing:.12em;text-transform:uppercase;font-size:11.5px}
.foot-links a{text-decoration:none;color:var(--fg)}
.langs{display:flex;gap:2px;border:1px solid var(--line2);font-size:11.5px;letter-spacing:.06em;text-transform:none}
.langs a,.langs b{padding:3px 8px;text-decoration:none;color:var(--mut);font-weight:400}
.langs b{background:var(--fg);color:#000}
.langs a:hover{color:var(--fg)}
.doc-note{border:1px solid var(--line2);padding:10px 14px;color:var(--mut)!important;font-size:12.5px}

@media(max-width:860px){
.doc-wrap{grid-template-columns:minmax(0,1fr);gap:22px;padding-top:30px}
.toc{position:static;border:1px solid var(--line2);padding:14px 16px}
.hero-in{grid-template-columns:minmax(0,1fr);padding-top:34px;padding-bottom:46px}
.notes,.vows,.cols{grid-template-columns:minmax(0,1fr)}
.pipe{grid-template-columns:repeat(2,minmax(0,1fr))}
.pipe li{border-top:1px solid var(--line2)}
.pipe li:nth-child(odd){border-left:0}.pipe li:nth-child(-n+2){border-top:0}
.rc-wrap{grid-template-columns:minmax(0,1fr)}
.verdict{grid-template-columns:minmax(0,1fr);gap:18px}
.verdict .stamp{justify-self:start}
.sec{padding-top:48px}
}
@media(max-width:600px){
.probe input{font-size:16px}
.probe button{padding:0 14px}
.tile{padding:12px 10px 14px}
.tile-s{font-size:11.5px}
.hud-b{padding:16px 12px}
.yax,.plot{height:150px}
}
@media(prefers-reduced-motion:reduce){
html{scroll-behavior:auto}
.rain::before,.rain::after,.pulse,.polaroid,.col{animation:none}
a.polaroid:hover,a.polaroid:focus-visible{transform:rotate(var(--r))}
}
`;

/** The document pages every page links to, in the bar and in the footer. */
/** Where the project lives. `x` stays null until the owner gives the account: no link is shown for it until then. */
export const SOCIAL: { github: string; x: string | null } = { github: "https://github.com/Aceop-001/fiangshi", x: "https://x.com/aceop_xyz" };
/** Pages link out only to these addresses, as plain links (never an asset, a form target or a script). Tests strip them before checking. */
export const OUTBOUND_LINKS: string[] = [SOCIAL.github, `${SOCIAL.github}/blob/main/SUBMISSION.md`, ...(SOCIAL.x ? [SOCIAL.x] : [])];
const SOCIAL_LINKS: [href: string, label: string][] = [[SOCIAL.github, "GitHub"], ...(SOCIAL.x ? ([[SOCIAL.x, "X"]] as [string, string][]) : [])];
export const SITE_LINKS: [href: string, label: string][] = [["/docs", "Docs"], ["/judges", "For judges"], ...SOCIAL_LINKS];
/** footer: every documentation page */
export const FOOT_LINKS: [href: string, label: string][] = DOC_PAGES.map((d) => [d.path, d.label]);

const MODE_NOTE: Record<string, string> = {
  fixture: "<strong>Fixture mode.</strong> Provider replies are recorded responses replayed through the real parser, vows and receipt chain.",
  mock: "<strong>Mock mode.</strong> Probes are live; model advice is mocked because no model keys are set.",
  static: "<strong>Static edition.</strong> These pages are pre-built from the committed census. Live checks run on the Fiangshi API: see <a href=\"/cli\">CLI and skill</a> or <a href=\"/connect\">Connect</a>.",
};

export interface Shell {
  title: string;
  description: string;
  /** e.g. "census 2026-11-09 02:57 UTC · 90-day window" */
  status: string;
  body: string;
  /** links shown in the bar; the index passes its section anchors, other pages get the default */
  nav?: [href: string, label: string][];
  foot: string;
  /** page-specific styles appended to the shared sheet */
  css?: string;
}

export function page(s: Shell): string {
  const mode = staticSite() ? "static" : providerMode();
  const links = s.nav ?? ([["/#census", "Census"], ...SITE_LINKS] as [string, string][]);
  const nav = `<nav aria-label="Site">${links.map(([h, l]) => `<a href="${esc(h)}">${esc(T(l))}</a>`).join("")}</nav>`;
  const switcher = `<nav class="langs" aria-label="${T("Language")}">${LANGS.map((l) => (l.code === lang() ? `<b aria-current="true">${l.label}</b>` : `<a href="${esc(l.code === "en" ? pagePath : `/${l.code}${pagePath === "/" ? "" : pagePath}`)}" hreflang="${l.html}" lang="${l.html}" data-nolang>${l.label}</a>`)).join("")}</nav>`;
  return `<!doctype html>
<html lang="${LANGS.find((l) => l.code === lang())!.html}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${liveApi() ? CSP.replace("form-action 'self'", `form-action 'self' ${liveApi()}`) : CSP}">
<meta name="description" content="${esc(s.description)}">
<meta name="theme-color" content="#000000">
<title>${esc(s.title)}</title>
<link rel="icon" href="${FAVICON}">
<style>${CSS}${s.css ?? ""}</style></head><body>
<header class="bar"><div class="wrap bar-in"><a class="brand" href="/">FIANGSHI</a>${nav}${switcher}<span class="state"><i class="pulse${mode === "live" ? "" : " off"}"></i>${esc(s.status)} · ${mode === "static" ? esc(T("static edition")) : `${esc(T("providers {mode}", { mode }))} · ${esc(T("settlement dry-run"))}`}</span></div></header>
${MODE_NOTE[mode] ? `<div class="modebar"><p class="wrap">${T(MODE_NOTE[mode]!)}</p></div>` : ""}
${s.body}
<footer><div class="wrap foot"><p class="foot-links"><a href="/docs">${esc(T("Docs"))}</a>${FOOT_LINKS.map(([h, l]) => `<a href="${h}">${esc(T(l))}</a>`).join("")}<a href="/v1/index.json">index.json</a>${SOCIAL_LINKS.map(([h, l]) => `<a href="${esc(h)}" rel="noopener">${esc(T(l))}</a>`).join("")}<span>${T("MIT licence")}</span></p>${s.foot}</div></footer>
</body></html>
`;
}

/** The free probe form (plain GET, no script). */
export function probeForm(value = "", id = "u"): string {
  // the static edition has no server to probe with: say so, and show the one-line way to run a check
  // static edition with a live API: the same form, sent to the API, which renders the answer page
  if (liveApi())
    return `<form class="probe" action="${esc(liveApi())}/check" method="get"><label for="${id}">${T("Paid endpoint URL")}</label><div class="probe-row"><span aria-hidden="true">&gt;&gt;</span><input id="${id}" name="url" type="url" required maxlength="2000" placeholder="https://api.example.com/paid" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(value)}"><button type="submit">${T("Probe")}</button></div></form>`;
  if (staticSite())
    return `<div class="probe probe-static"><p class="probe-l">${T("Paid endpoint URL")}</p><div class="probe-row"><span aria-hidden="true">&gt;&gt;</span><code>fiangshi preview "https://api.example.com/paid"</code></div><p class="mut">${T("Live checks need the Fiangshi API, which this static page cannot run. Start it in one command, or connect your agent: {cli} · {connect}.", { cli: '<a href="/cli">CLI</a>', connect: '<a href="/connect">Connect</a>' })}</p></div>`;
  return `<form class="probe" action="/check" method="get"><label for="${id}">${T("Paid endpoint URL")}</label><div class="probe-row"><span aria-hidden="true">&gt;&gt;</span><input id="${id}" name="url" type="url" required maxlength="2000" placeholder="https://api.example.com/paid" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(value)}"><button type="submit">${T("Probe")}</button></div></form>`;
}
