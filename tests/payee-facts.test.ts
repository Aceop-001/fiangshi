import { describe, it, expect } from "vitest";
import { buildSql } from "../scripts/surf/payee-facts.js";

const A = "0x4aabe17c239ef71c3a26ba7c2b3e0aebbfc1df26";
const B = "0xF567CFE0FDB87A1D6CA330E3F30F0D3DA0F7CB98";

describe("surf payee-facts SQL builder", () => {
  it("takes a payee array: dedupes, lowercases, quotes, fills both branches", () => {
    const sql = buildSql([A, B, A.toUpperCase().replace("0X", "0x")]);
    expect(sql.match(/IN \('0x4aabe17c239ef71c3a26ba7c2b3e0aebbfc1df26','0xf567cfe0fdb87a1d6ca330e3f30f0d3da0f7cb98'\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/__PAYEES__|__DAYS__|lower\(/);
    expect(sql).toMatch(/block_date >= today\(\) - 365/);
  });
  it("rejects anything that is not a 0x+40hex address (no SQL injection)", () => {
    expect(() => buildSql(["0xabc' OR 1=1 --"])).toThrow(/invalid payee/);
    expect(() => buildSql([])).toThrow(/no payees/);
  });
  it("never ORs from/to predicates (Surf rule)", () => {
    expect(buildSql([A])).not.toMatch(/`to` IN .* OR `from`/s);
  });
});
