import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeNoClobber } from "../src/fsutil.js";
import { tmp } from "./helpers.js";

describe("writeNoClobber (raw fixtures are never overwritten)", () => {
  it("first write uses the name; later writes get -attempt2, -attempt3", () => {
    const d = tmp();
    const a = writeNoClobber(join(d, "serv-0xabc.json"), "one");
    const b = writeNoClobber(join(d, "serv-0xabc.json"), "two");
    const c = writeNoClobber(join(d, "serv-0xabc.json"), "three");
    expect([a, b, c].map((p) => p.split(/[\\/]/).pop())).toEqual(["serv-0xabc.json", "serv-0xabc-attempt2.json", "serv-0xabc-attempt3.json"]);
    expect(readFileSync(a, "utf8")).toBe("one");
  });
});
