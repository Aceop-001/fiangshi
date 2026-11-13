/** The "Try it" table in docs/GUIDE.md: every example's answer, and every fact its "why" states, checked against the census. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { loadCensus } from "../src/census.js";
import { evaluateVows, KINSHIP_REVIEW_AT } from "../src/core/vows.js";

const guide = readFileSync(join(ROOT, "docs", "GUIDE.md"), "utf8");
const c = loadCensus();
const byUrl = (u: string) => c.payees.find((p) => p.url === u);
const kin = (u: string) => {
  const p = byUrl(u)!;
  const s = c.signals.get(p.payee)!;
  return { p, s, row: evaluateVows({ signals: s, price: p.price_usd, funder_labels: c.funderLabels }).find((r) => r.vow === "kinship")! };
};

/** rows of the table: link target url and the stated answer */
const rows = [...guide.matchAll(/^\| \[[^\]]+\]\(\/check\?url=([^)]+)\) \| ([^|]+) \|/gm)].map((m) => ({ url: decodeURIComponent(m[1]!), answer: m[2]!.trim() }));

const BITREFILL = "https://api.bitrefill.com/x402/gift-cards/search";
const HIVEMIND = "https://api.hivemindos.app/v1/x402/leadgen-data/leads.enrich";
const KRONOS = "https://kronossignals.com/api/v1/funding-extremes";
const TBS = "https://x402.tbs-digital.com/weather/current";

describe("guide examples are true", () => {
  it("the table has the six examples", () => {
    expect(rows.map((r) => r.answer)).toEqual(["ALLOW", "ALLOW", "ALLOW", "BLOCK", "BLOCK", "REVIEW"]);
  });
  it("every census example shows the band the census gives it (issued band, before the freshness cap)", () => {
    for (const r of rows.filter((x) => !x.url.includes("cleave"))) expect(byUrl(r.url)?.issued_band, r.url).toBe(r.answer);
  });
  it("ALLOW examples fire no rule; Bitrefill: 3,722 payers, name confirmed by host and label, a top score; Exa 455; CoinGecko 244", () => {
    for (const r of rows.filter((x) => x.answer === "ALLOW")) expect(byUrl(r.url)!.vows, r.url).toEqual([]);
    const b = byUrl(BITREFILL)!;
    expect(c.signals.get(b.payee)!.distinct_payers).toBe(3722);
    expect(b.identity.sources).toEqual(expect.arrayContaining(["host", "label"]));
    expect(c.payees.filter((p) => p.score > b.score).length).toBeLessThan(20);
    expect(c.signals.get(byUrl("https://api.exa.ai/search")!.payee)!.distinct_payers).toBe(455);
    const cg = byUrl("https://pro-api.coingecko.com/api/v3/x402/onchain/search/pools")!;
    expect(c.signals.get(cg.payee)!.distinct_payers).toBe(244);
    expect(cg.identity.sources).toEqual(expect.arrayContaining(["host"]));
  });
  it("cleave.fi pays the zero address (rule I)", () => {
    expect(byUrl("https://api.cleave.fi/x402/gas")!.payee).toBe("0x0000000000000000000000000000000000000000");
  });
  it("hivemindos: score alone would ALLOW, kinship BLOCKs on a small unnamed cluster", () => {
    const k = kin(HIVEMIND);
    expect(k.p.score).toBeGreaterThanOrEqual(80);
    expect(k.row).toMatchObject({ fired: true, band: "BLOCK" });
    expect(k.s.funder_fanout!).toBeLessThan(KINSHIP_REVIEW_AT);
    expect(c.funderLabels[k.p.first_funder!]).toBeUndefined();
  });
  it("kronossignals: kinship REVIEW as a suspected exchange (21+ others, unnamed funder)", () => {
    const k = kin(KRONOS);
    expect(k.row).toMatchObject({ fired: true, band: "REVIEW", flags: ["kinship_suspected_exchange"] });
    expect(k.s.funder_fanout!).toBeGreaterThanOrEqual(KINSHIP_REVIEW_AT);
  });
  it("every Base payee in the catalog has a record, and the TBS note is true (REVIEW by kinship, 46 others)", () => {
    expect(c.payees.length).toBe(c.catalog_payees);
    expect(guide).toContain(`${c.payees.length.toLocaleString("en-US")} of ${c.catalog_payees.toLocaleString("en-US")}`);
    const t = kin(TBS);
    expect(t.p.issued_band).toBe("REVIEW");
    expect(t.p.vows).toEqual(["kinship"]);
    expect(t.s.funder_fanout).toBe(46);
  });
});
