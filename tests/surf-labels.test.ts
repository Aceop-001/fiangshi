import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { funderLabelsFromSurf, type SurfWalletLabel } from "../src/adapters/surf.js";
import { evaluateVows } from "../src/core/vows.js";
import { clean } from "./helpers.js";

const real = (JSON.parse(readFileSync("fixtures/surf/labels-12payees.json", "utf8")) as { envelope: { data: SurfWalletLabel[] } }).envelope.data;

describe("Surf wallet labels -> kinship exclusion (real fixture)", () => {
  it("entity_type cex (Bybit, Bitrefill) maps to cex; USDC contract is a token, not a funder", () => {
    const { labels, tokenContracts } = funderLabelsFromSurf(real);
    expect(labels["0x6fa5b6d93e2539caea358518d3fe8f75418e5a1d"]).toBe("cex");
    expect(labels["0x480cd46e6fade651a0437deadda53d5c8e7d846a"]).toBe("cex");
    expect(tokenContracts).toContain("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(labels["0x3291e96b3bff7ed56e3ca8364273c5b4654b2b37"]).toBeUndefined(); // ENS name only
  });

  it("a CEX-labelled funder shared by 5 payees does NOT fire kinship", () => {
    const { labels } = funderLabelsFromSurf(real);
    const s = clean({ first_funder: "0x6fa5b6d93e2539caea358518d3fe8f75418e5a1d", funder_fanout: 5 });
    expect(evaluateVows({ signals: s, price: 0.05, funder_labels: labels }).find((r) => r.vow === "kinship")!.fired).toBe(false);
  });

  it("fanout heuristic: unlabelled funder with >= 500 distinct receivers is exchange-like; 499 is not", () => {
    expect(funderLabelsFromSurf([], { "0xAbC": 500 }).labels["0xabc"]).toBe("cex");
    expect(funderLabelsFromSurf([], { "0xabc": 499 }).labels["0xabc"]).toBeUndefined();
  });
});
