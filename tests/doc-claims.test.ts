// I (post-deadline): the repo's own docs must not contradict the code. A paid cold check calls Surf (src/cold-surf.ts),
// so the old claim that the API never does must not come back in any tracked doc.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "../src/config.js";

/** Tracked docs from git; outside a checkout (a tarball, a zip) the same set by walking the tree. */
function docs(): string[] {
  try {
    return execFileSync("git", ["ls-files", "*.md", ".env.example"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).filter(Boolean);
  } catch {
    const SKIP = new Set(["node_modules", ".git", "data", "dist", "coverage"]);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (SKIP.has(e.name) ? [] : walk(join(dir, e.name))) : e.name.endsWith(".md") || e.name === ".env.example" ? [relative(ROOT, join(dir, e.name))] : [],
      );
    return walk(ROOT);
  }
}
const DOCS = docs();
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
