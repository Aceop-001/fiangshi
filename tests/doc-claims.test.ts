// I (post-deadline): the repo's own docs must not contradict the code. A paid cold check calls Surf (src/cold-surf.ts),
// so the old claim that the API never does must not come back in any tracked doc.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";

const DOCS = execFileSync("git", ["ls-files", "*.md", ".env.example"], { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const STALE = [/\bAPI never calls Surf\b/i, /scripts only; the API/i, /server never calls Surf\b(?! for the census)/i];

describe("doc claims match the code", () => {
  it("there are docs to check", () => expect(DOCS.length).toBeGreaterThan(10));
  it("no tracked doc says the API never calls Surf", () => {
    const hits = DOCS.flatMap((f) => readFileSync(join(ROOT, f), "utf8").split(/\r?\n/).flatMap((l, i) => (STALE.some((re) => re.test(l)) ? [`${f}:${i + 1}: ${l.trim()}`] : [])));
    expect(hits).toEqual([]);
  });
  it(".env.example and KNOWN_LIMITS state the true rule", () => {
    for (const f of [".env.example", "docs/KNOWN_LIMITS.md"]) expect(readFileSync(join(ROOT, f), "utf8")).toMatch(/Surf is called only on a paid cold check/);
  });
  it("the cold path really calls Surf (the claim the docs make)", () => {
    expect(readFileSync(join(ROOT, "src/cold-surf.ts"), "utf8")).toMatch(/surf/i);
  });
  it("KNOWN_LIMITS stays at 400 words or fewer and is linked from the README", () => {
    const words = readFileSync(join(ROOT, "docs/KNOWN_LIMITS.md"), "utf8").split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(400);
    expect(readFileSync(join(ROOT, "README.md"), "utf8")).toContain("(docs/KNOWN_LIMITS.md)");
  });
});
