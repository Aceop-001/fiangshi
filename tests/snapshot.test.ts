import { describe, it, expect } from "vitest";
import { buildSnapshot, computeFanout, normalizePayees } from "../src/snapshot.js";
import { hashOf } from "../src/core/canonical.js";
import { clean } from "./helpers.js";

describe("snapshot", () => {
  it("fixture snapshot_id is stable across two builds", async () => {
    const a = await buildSnapshot();
    const b = await buildSnapshot();
    expect(a.snapshot.snapshot_id).toBe(b.snapshot.snapshot_id);
    expect(a.snapshot.snapshot_id).toBe(hashOf(a.snapshot.payload));
  });

  it("fixture build makes 0 data calls (<=5 budget)", async () => {
    expect((await buildSnapshot()).calls).toBeLessThanOrEqual(5);
  });

  it("kinship fanout counts <=2-hop shared non-CEX funders", () => {
    const ps = [
      clean({ payee: "a", first_funder: "f1" }),
      clean({ payee: "b", first_funder: "f1" }),
      clean({ payee: "c", first_funder: "f2" }),
      clean({ payee: "d", first_funder: "f2" }),
      clean({ payee: "e", first_funder: "cex" }),
      clean({ payee: "g", first_funder: "cex" }),
    ];
    const fan = computeFanout(ps, { labels: { cex: "cex" }, edges: { f1: "root", f2: "root" } });
    expect(fan.get("a")).toBe(3);
    expect(fan.get("e")).toBe(0);
  });

  it("sybil fixtures are detected as a 4-payee cluster", async () => {
    const { snapshot } = await buildSnapshot();
    const fanned = snapshot.payload.payees.filter((p) => (p.funder_fanout ?? 0) >= 3);
    expect(fanned).toHaveLength(4);
  });

  it("invalid rows are rejected, not crashed on", () => {
    const { payees, rejected } = normalizePayees([clean({ payee: "ok" }), { payee: "broken" }]);
    expect(payees.map((p) => p.payee)).toEqual(["ok"]);
    expect(rejected).toBe(1);
  });
});
