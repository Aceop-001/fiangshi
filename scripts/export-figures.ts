/**
 * Writes the site's live figures as standalone animated SVG files for GitHub (docs/assets/), so the README shows the
 * same moving pictures as fiangshi.xyz. 0 credits, no network.
 *   npx tsx scripts/export-figures.ts
 * - fig-1-map.svg … fig-5-receipt-chain.svg: the five architecture figures from src/arch-visuals.ts (SMIL animation),
 *   with a black background and the figure CSS embedded, since a README image cannot read the site's stylesheet.
 * - agent-run.svg: a replay of the 15 Nov buyer-side run on Base mainnet (the same run as /judges and home chapter 07).
 *   Every line is a fact from that run: verdicts and scores as /v1/preview answers them, the twit.sh tx hash checked on
 *   Base (block 57,794,100, status success, 0.006 USDC), the wallet's 0.100 -> 0.084 USDC.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { FIGURES } from "../src/arch-visuals.js";

const OUT = join(ROOT, "docs", "assets");
mkdirSync(OUT, { recursive: true });

const EMBED = `<style>.fx-static{display:none}@media(prefers-reduced-motion:reduce){.fx-move,.fx-tag,.fx-case{display:none}.fx-static{display:inline}.fx-end,.fx-why{opacity:1!important}}</style>`;
const names: Record<string, string> = {
  "the map": "fig-1-map",
  "one check, live": "fig-2-three-checks",
  "who talks to whom": "fig-3-money",
  "lowest band wins": "fig-4-lowest-band",
  "the receipt chain": "fig-5-receipt-chain",
};
for (const [key, file] of Object.entries(names)) {
  const svg = FIGURES[key]!.svg().replace(/^<svg([^>]*)>/, (_m, attrs: string) => `<svg${attrs}>${EMBED}<rect x="-20" y="-20" width="2000" height="2000" fill="#000"/>`);
  writeFileSync(join(OUT, `${file}.svg`), svg + "\n");
}

/* ---------------------------------------------------------------- the agent run ---------------------------------- */
const W = 760;
const LOOP = 16;
const MONO = `font-family="ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace"`;
const FG = "#f2f2f2", MUT = "#9c9c9c", REDT = "#ff4b41", RED = "#e5191c", LINE = "#3d3d3d";
type Seg = [string, string, boolean?]; // text, colour, bold
const lines: { t: number; segs: Seg[] }[] = [
  { t: 0.3, segs: [["$ ", REDT], ["agent run --wallet 0x2DfF…303d --cap $0.05", FG]] },
  { t: 1.3, segs: [["balance ", MUT], ["0.1000", FG, true], [" USDC · Base mainnet", MUT]] },
  { t: 2.3, segs: [["? ", MUT], ["kronos.forgemesh.io ", FG], ["$0.05  ", MUT], ["■ BLOCK ", REDT, true], ["52.61 kinship  ", FG], ["refused · $0.00", REDT]] },
  { t: 3.9, segs: [["? ", MUT], ["api.nexismvp.com ", FG], ["$0.001  ", MUT], ["■ BLOCK ", REDT, true], ["62.18 kinship  ", FG], ["refused · $0.00", REDT]] },
  { t: 5.5, segs: [["? ", MUT], ["pro-api.coinmarketcap.com ", FG], ["$0.01  ", MUT], ["● ALLOW ", FG, true], ["86.01  ", FG], ["paid · −0.010", FG]] },
  { t: 7.1, segs: [["? ", MUT], ["x402.twit.sh ", FG], ["$0.006  ", MUT], ["● ALLOW ", FG, true], ["86.19  ", FG], ["paid · tx 0x4e7a…3271", FG]] },
  { t: 8.9, segs: [["balance ", FG], ["0.0840", FG, true], [" USDC · spent ", FG], ["$0.016", FG, true], [" · refused ", FG], ["$0.051", REDT, true]] },
];
const f = (n: number) => Number(n.toFixed(4)).toString();
const kt = (s: number) => f(Math.min(0.999, s / LOOP));
let body = "";
lines.forEach((l, i) => {
  const y = 64 + i * 26 + (i === lines.length - 1 ? 10 : 0);
  const a = kt(l.t), b = kt(l.t + 0.9);
  body += `<clipPath id="c${i}"><rect x="0" y="${y - 16}" height="24" width="${W}"><animate attributeName="width" values="0;0;${W};${W};0" keyTimes="0;${a};${b};0.96;1" dur="${LOOP}s" repeatCount="indefinite"/></rect></clipPath>`;
  body += `<text x="22" y="${y}" font-size="13" ${MONO} clip-path="url(#c${i})" class="ln">${l.segs.map(([t, c, bold]) => `<tspan fill="${c}"${bold ? ' font-weight="700"' : ""}>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</tspan>`).join("")}</text>`;
});
const sumY = 64 + (lines.length - 1) * 26 - 8;
const barY = 64 + lines.length * 26 + 26;
const agent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${barY + 30}" width="${W}" height="${barY + 30}" role="img" aria-label="Replay of the 15 Nov 2026 agent run on Base mainnet: two sellers refused with BLOCK at $0.00, two paid after ALLOW, balance 0.1000 to 0.0840 USDC">
<style>@media(prefers-reduced-motion:reduce){.ln{clip-path:none}}</style>
<rect width="${W}" height="${barY + 30}" fill="#050505" stroke="${LINE}"/>
<rect width="${W}" height="30" fill="#000" stroke="${LINE}"/>
<circle cx="18" cy="15" r="5" fill="${RED}"/><circle cx="34" cy="15" r="5" fill="#2a2a2a"/><circle cx="50" cy="15" r="5" fill="#2a2a2a"/>
<text x="68" y="19" font-size="11" letter-spacing="1" fill="${MUT}" ${MONO}>agent · Base mainnet · USDC · replay of 15 Nov 2026</text>
<line x1="22" y1="${sumY}" x2="${W - 22}" y2="${sumY}" stroke="${LINE}" stroke-dasharray="3 4"/>
${body}
<text x="22" y="${barY + 4}" font-size="11" fill="${MUT}" ${MONO}>wallet</text>
<rect x="80" y="${barY - 4}" width="460" height="7" fill="#1a1a1a"/>
<rect x="80" y="${barY - 4}" height="7" width="386.4" fill="${FG}"><animate attributeName="width" values="460;460;414;414;386.4;386.4;460" keyTimes="0;${kt(6.2)};${kt(6.6)};${kt(7.8)};${kt(8.2)};0.96;1" dur="${LOOP}s" repeatCount="indefinite"/></rect>
<text x="${W - 22}" y="${barY + 4}" text-anchor="end" font-size="12" fill="${FG}" ${MONO}>0.100 → 0.084 USDC</text>
</svg>
`;
writeFileSync(join(OUT, "agent-run.svg"), agent);

/* ---------------------------------------------------------------- the no-wallet run --------------------------------- */
// Five free previews and two unpaid checks against the live API on 15 Nov 2026 (cost_usd 0 each; cleave.fi's /v1/check
// answered 200 BLOCK null_payee at $0, Bitrefill's answered 402 with x402Version 2, amount 50000, eip155:8453).
const free: { t: number; segs: Seg[] }[] = [
  { t: 0.3, segs: [["$ ", REDT], ["curl -s api.fiangshi.xyz/v1/preview?url=…   (no wallet, no key)", FG]] },
  { t: 1.4, segs: [["? ", MUT], ["kronos.forgemesh.io ", FG], ["$0.05  ", MUT], ["■ BLOCK ", REDT, true], ["52.61 kinship  ", FG], ["cost $0", MUT]] },
  { t: 2.6, segs: [["? ", MUT], ["api.nexismvp.com ", FG], ["$0.001  ", MUT], ["■ BLOCK ", REDT, true], ["62.18 kinship  ", FG], ["cost $0", MUT]] },
  { t: 3.8, segs: [["? ", MUT], ["api.cleave.fi ", FG], ["$0.80  ", MUT], ["■ BLOCK ", REDT, true], ["null_payee  ", FG], ["cost $0", MUT]] },
  { t: 5.0, segs: [["? ", MUT], ["pro-api.coinmarketcap.com ", FG], ["$0.01  ", MUT], ["● ALLOW ", FG, true], ["86.01  ", FG], ["cost $0", MUT]] },
  { t: 6.2, segs: [["? ", MUT], ["x402.twit.sh ", FG], ["$0.006  ", MUT], ["● ALLOW ", FG, true], ["86.19  ", FG], ["cost $0", MUT]] },
  { t: 7.6, segs: [["would have spent on the blocked ones: ", FG], ["$0.851", REDT, true]] },
  { t: 8.8, segs: [["$ ", REDT], ["curl -si …/v1/check?url=…bitrefill…  ", MUT], ["402 · x402Version 2 · 50000 · eip155:8453", FG]] },
  { t: 10.2, segs: [["No wallet. No funds. Nothing paid. Fiangshi's checks are free.", FG, true]] },
];
let fb = "";
free.forEach((l, i) => {
  const y = 64 + i * 26 + (i >= 6 ? 10 : 0);
  const a = kt(l.t), b = kt(l.t + 0.9);
  fb += `<clipPath id="f${i}"><rect x="0" y="${y - 16}" height="24" width="${W}"><animate attributeName="width" values="0;0;${W};${W};0" keyTimes="0;${a};${b};0.96;1" dur="${LOOP}s" repeatCount="indefinite"/></rect></clipPath>`;
  fb += `<text x="22" y="${y}" font-size="13" ${MONO} clip-path="url(#f${i})" class="ln">${l.segs.map(([t, c, bold]) => `<tspan fill="${c}"${bold ? ' font-weight="700"' : ""}>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</tspan>`).join("")}</text>`;
});
const fh = 64 + free.length * 26 + 20;
const freeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${fh}" width="${W}" height="${fh}" role="img" aria-label="Replay of the no-wallet run: three sellers BLOCK, two ALLOW, every check $0, $0.851 that would have gone to the blocked ones, and a paid check that answered 402 without anyone paying">
<style>@media(prefers-reduced-motion:reduce){.ln{clip-path:none}}</style>
<rect width="${W}" height="${fh}" fill="#050505" stroke="${LINE}"/>
<rect width="${W}" height="30" fill="#000" stroke="${LINE}"/>
<circle cx="18" cy="15" r="5" fill="${RED}"/><circle cx="34" cy="15" r="5" fill="#2a2a2a"/><circle cx="50" cy="15" r="5" fill="#2a2a2a"/>
<text x="68" y="19" font-size="11" letter-spacing="1" fill="${MUT}" ${MONO}>curl · no wallet · no key · replay of 15 Nov 2026</text>
<line x1="22" y1="${64 + 6 * 26 - 8}" x2="${W - 22}" y2="${64 + 6 * 26 - 8}" stroke="${LINE}" stroke-dasharray="3 4"/>
${fb}
</svg>
`;
writeFileSync(join(OUT, "free-run.svg"), freeSvg);
console.log(`wrote ${Object.keys(names).length + 2} SVGs to docs/assets`);
