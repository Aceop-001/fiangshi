/** Guard against fixture loss (the generator once deleted fixtures/402/real). Also run by `npm run accept` (G11). */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadFixtures402, parse402 } from "../src/adapters/probe.js";

export const REAL_DIR = join("fixtures", "402", "real");
export const MIN_REAL = 12;

describe("fixture integrity: fixtures/402/real", () => {
  it(`has >= ${MIN_REAL} non-empty .json files`, () => {
    const files = readdirSync(REAL_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(MIN_REAL);
    for (const f of files) expect(statSync(join(REAL_DIR, f)).size, f).toBeGreaterThan(0);
  });
  it("every recorded real 402 parses", () => {
    const bad = loadFixtures402(REAL_DIR).map(parse402).filter((r) => !r.ok);
    expect(bad.map((b) => !b.ok && `${b.raw?.url}: ${b.error}`)).toEqual([]);
  });
});
