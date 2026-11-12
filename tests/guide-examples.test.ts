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

describe("guide examples are true", () => {
  it("the table has the seven examples", () => {
    expect(rows.map((r) => r.answer)).toEqual(["ALLOW", "ALLOW", "ALLOW", "BLOCK", "BLOCK", "REVIEW", "no record (free)"]);
  });
  it("every census example shows the band the census gives it", () => {
    for (const r of rows.filter((x) => ["ALLOW", "REVIEW"].includes(x.answer) || x.url.includes("kronossignals"))) {
      expect(byUrl(r.url)?.band, r.url).toBe(r.answer);
    }
  });
  it("ALLOW examples fire no rule; TBS has 101 payers and a corroborated name; Nansen is near the top", () => {
    for (const r of rows.filter((x) => x.answer === "ALLOW")) expect(byUrl(r.url)!.vows, r.url).toEqual([]);
    const tbs = byUrl("https://x402.tbs-digital.com/weather/current")!;
    expect(c.signals.get(tbs.payee)!.distinct_payers).toBe(101);
    expect(tbs.identity.sources).toEqual(expect.arrayContaining(["host"]));
    const nansen = byUrl("https://api.nansen.ai/api/v1/profiler/address/current-balance")!;
    expect(c.payees.filter((p) => p.score > nansen.score).length).toBe(0);
  });
  it("cleave.fi pays the zero address (rule I)", () => {
    expect(byUrl("https://api.cleave.fi/x402/gas")!.payee).toBe("0x0000000000000000000000000000000000000000");
  });
  it("kronossignals: score alone would ALLOW, kinship BLOCKs on a small cluster", () => {
    const k = kin("https://kronossignals.com/api/v1/funding-extremes");
    expect(k.p.score).toBeGreaterThanOrEqual(80);
    expect(k.row).toMatchObject({ fired: true, band: "BLOCK" });
    expect(k.s.funder_fanout!).toBeLessThan(KINSHIP_REVIEW_AT);
  });
  it("hyperextend: kinship REVIEW as a suspected exchange (21+ others, unnamed funder)", () => {
    const k = kin("https://api.hyperextend.xyz/v1/candles/BTC/1m/latest");
    expect(k.row).toMatchObject({ fired: true, band: "REVIEW", flags: ["kinship_suspected_exchange"] });
    expect(k.s.funder_fanout!).toBeGreaterThanOrEqual(KINSHIP_REVIEW_AT);
  });
  it("bitrefill is a real seller outside the census", () => {
    const r = rows.find((x) => x.url.includes("bitrefill"))!;
    expect(c.payees.some((p) => p.url === r.url)).toBe(false);
    const fx = JSON.parse(readFileSync(join(ROOT, "fixtures", "402", "real", "api.bitrefill.com.json"), "utf8"));
    expect(c.payees.some((p) => JSON.stringify(fx).toLowerCase().includes(p.payee))).toBe(false);
  });
});
