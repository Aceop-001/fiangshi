import { describe, it, expect } from "vitest";
import { decide } from "../src/core/decide.js";
import { decidingVow, evaluateVows } from "../src/core/vows.js";
import type { PayeeSignals, VowName, Band } from "../src/core/types.js";
import { advice, allowRaw, clean, LABELS } from "./helpers.js";

const anon = { claims_org: null, claims_product: null, corroborated: null };
const table: { name: string; s: PayeeSignals; price: number | null; fires: VowName[]; band: Band }[] = [
  { name: "clean payee fires nothing", s: clean(), price: 0.05, fires: [], band: "ALLOW" },
  { name: "age 47h -> age BLOCK", s: clean({ wallet_age_hours: 47 }), price: 0.05, fires: ["age"], band: "BLOCK" },
  { name: "age 48h exactly -> no age vow", s: clean({ wallet_age_hours: 48, identity: anon }), price: 0.05, fires: [], band: "ALLOW" },
  { name: "non-CEX funder fanout 3 -> kinship BLOCK", s: clean({ first_funder: "0xring", funder_fanout: 3 }), price: 0.05, fires: ["kinship"], band: "BLOCK" },
  { name: "non-CEX funder fanout 2 -> no kinship", s: clean({ first_funder: "0xring", funder_fanout: 2 }), price: 0.05, fires: [], band: "ALLOW" },
  { name: "CEX funder fanout 50 -> no kinship", s: clean({ funder_fanout: 50 }), price: 0.05, fires: [], band: "ALLOW" },
  { name: "kinship v2: unlabelled funder fanout 20 -> still BLOCK (lab B2 sits here)", s: clean({ first_funder: "0xring", funder_fanout: 20 }), price: 0.05, fires: ["kinship"], band: "BLOCK" },
  { name: "kinship v2: unlabelled funder fanout 21 -> REVIEW (suspected exchange)", s: clean({ first_funder: "0xring", funder_fanout: 21 }), price: 0.05, fires: ["kinship"], band: "REVIEW" },
  { name: "kinship v2: unlabelled funder fanout 48 -> REVIEW", s: clean({ first_funder: "0xring", funder_fanout: 48 }), price: 0.05, fires: ["kinship"], band: "REVIEW" },
  { name: "kinship v2: a funder labelled mixer never softens, fanout 48 -> BLOCK", s: clean({ first_funder: "0xmixer", funder_fanout: 48 }), price: 0.05, fires: ["kinship"], band: "BLOCK" },
  { name: "0 payers & price $0.51 -> history REVIEW", s: clean({ distinct_payers: 0 }), price: 0.51, fires: ["history"], band: "REVIEW" },
  { name: "0 payers & price $0.50 -> no history", s: clean({ distinct_payers: 0 }), price: 0.5, fires: [], band: "ALLOW" },
  {
    name: "uncorroborated claim & age 100h -> no identity vow (neutral: identical to no claim)",
    s: clean({ wallet_age_hours: 100, identity: { claims_org: "Acme", claims_product: null, corroborated: false } }),
    price: 0.05, fires: [], band: "ALLOW",
  },
  {
    name: "uncorroborated claim & age 5000h -> no identity vow",
    s: clean({ wallet_age_hours: 5000, identity: { claims_org: "Acme", claims_product: null, corroborated: false } }),
    price: 0.05, fires: [], band: "ALLOW",
  },
  {
    name: "contradicted claim (a label names someone else) -> identity BLOCK",
    s: clean({ identity: { claims_org: "Acme", claims_product: null, corroborated: false, contradicted: true } }),
    price: 0.05, fires: ["identity"], band: "BLOCK",
  },
  {
    name: "no claim -> no identity vow",
    s: clean({ identity: { claims_org: null, claims_product: null, corroborated: null } }),
    price: 0.05, fires: [], band: "ALLOW",
  },
  { name: "missing tx_count -> silence REVIEW", s: clean({ tx_count: null }), price: 0.05, fires: ["silence"], band: "REVIEW" },
  { name: "missing price -> silence REVIEW", s: clean(), price: null, fires: ["silence"], band: "REVIEW" },
];

describe("vows (table-driven)", () => {
  for (const t of table)
    it(t.name, () => {
      const rows = evaluateVows({ signals: t.s, price: t.price, funder_labels: LABELS });
      expect(rows.filter((r) => r.fired).map((r) => r.vow)).toEqual(t.fires);
      expect(decidingVow(rows)?.band ?? "ALLOW").toBe(t.band);
    });

  it("precedence: most severe wins; age beats silence; tie broken by listed order", () => {
    const rows = evaluateVows({ signals: clean({ wallet_age_hours: 10, first_funder: "0xring", funder_fanout: 5, tx_count: null }), price: 0.05, funder_labels: LABELS });
    expect(rows.filter((r) => r.fired).map((r) => r.vow)).toEqual(["age", "kinship", "silence"]);
    expect(decidingVow(rows)!.vow).toBe("age");
  });

  it("model=ALLOW but vow=BLOCK -> BLOCK (the vows decide)", () => {
    const s = clean({ wallet_age_hours: 5 });
    const d = decide(s, 0.05, LABELS, advice(allowRaw(s), s));
    expect(d.modelRawBand).toBe("ALLOW");
    expect(d.verdict.band).toBe("BLOCK");
    expect(d.verdict.vow_fired).toBe("age");
  });

  it("model cannot raise above score band (low score + model ALLOW -> BLOCK by score)", () => {
    const s = clean({ first_funder: "0xmixer", distinct_payers: 1, repeat_payers: 0, wallet_age_hours: 60, tx_count: 2, token_asset_share: 0.9, identity: anon });
    const d = decide(s, 0.05, LABELS, advice(allowRaw(s), s));
    expect(d.scoreBand).toBe("BLOCK");
    expect(d.verdict.band).toBe("BLOCK");
  });

  it("model BLOCK alone is applied as REVIEW (BLOCK needs a machine-checkable reason)", () => {
    const s = clean();
    const raw = JSON.stringify({ band: "BLOCK", citations: [{ signal: "tx_count", quote: "800 tx" }] });
    const d = decide(s, 0.05, LABELS, advice(raw, s));
    expect(d.verdict.band).toBe("REVIEW");
    expect(d.verdict.degraded).toBe(false);
  });
});

describe("kinship threshold v2 only ever softens, and says why", () => {
  it("a suspected-exchange REVIEW carries the flag; a small ring does not", () => {
    const big = evaluateVows({ signals: clean({ first_funder: "0xring", funder_fanout: 33 }), price: 0.05, funder_labels: LABELS }).find((r) => r.vow === "kinship")!;
    expect(big).toMatchObject({ fired: true, band: "REVIEW", flags: ["kinship_suspected_exchange"] });
    expect(big.reason).toContain("kinship_suspected_exchange");
    const small = evaluateVows({ signals: clean({ first_funder: "0xring", funder_fanout: 5 }), price: 0.05, funder_labels: LABELS }).find((r) => r.vow === "kinship")!;
    expect(small.band).toBe("BLOCK");
    expect(small.flags).toBeUndefined();
  });
  it("never creates a BLOCK: across every fanout the v2 band is never stricter than the v1 band (always BLOCK when fired)", () => {
    for (let f = 0; f <= 60; f++) {
      const r = evaluateVows({ signals: clean({ first_funder: "0xring", funder_fanout: f }), price: 0.05, funder_labels: LABELS }).find((x) => x.vow === "kinship")!;
      expect(r.fired).toBe(f >= 3);
      if (r.fired) expect(["BLOCK", "REVIEW"]).toContain(r.band);
    }
  });
});
