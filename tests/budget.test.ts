import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { BudgetExceeded, OfflineRefused, guarded } from "../scripts/budget.js";
import { extractIdentity } from "../src/adapters/dolphin.js";
import { tmp } from "./helpers.js";

describe("budget guard", () => {
  it("refuses call N+1 past the cap and logs it to costs.md", async () => {
    const d = tmp();
    const opts = { counterPath: join(d, "budget.json"), costsPath: join(d, "costs.md"), cap: 3, ignoreOffline: true };
    let ran = 0;
    const fn = async () => ({ value: ++ran, units: 2 });
    for (let i = 0; i < 3; i++) await guarded("surf", "batch", fn, opts);
    await expect(guarded("surf", "batch", fn, opts)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(ran).toBe(3);
    expect(readFileSync(opts.costsPath, "utf8")).toMatch(/4\/3 .*REFUSED/);
  });

  it("refuses every live call when FIANGHSI_OFFLINE=1, without counting", async () => {
    const d = tmp();
    await expect(guarded("serv", "x", async () => ({ value: 1 }), { counterPath: join(d, "b.json") })).rejects.toBeInstanceOf(OfflineRefused);
    expect(existsSync(join(d, "b.json"))).toBe(false);
  });
});

describe("dolphin cache", () => {
  it("second extraction of the same bio is a cache hit with 0 new calls", async () => {
    const dir = tmp();
    let calls = 0;
    const transport = async () => (calls++, { claims_org: "Acme", claims_product: "Acme API", claims_age_claim: null });
    const a = await extractIdentity("Acme - the API", transport, dir);
    const b = await extractIdentity("Acme - the API", transport, dir);
    expect(a).toMatchObject({ cached: false, calls: 1 });
    expect(b).toMatchObject({ cached: true, calls: 0 });
    expect(calls).toBe(1);
  });
  it("offline with default transport -> no claims, no crash", async () => {
    expect((await extractIdentity("x", undefined, tmp())).claims).toBeNull();
  });
});
