import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { auditReport, buildSample, type AuditRaw } from "../scripts/audit.js";
import { signalsFromSurf } from "../src/adapters/surf.js";

const smoke = JSON.parse(readFileSync("fixtures/surf/smoke-12payees.json", "utf8")) as { rows: AuditRaw["rows"] };
const labels = (JSON.parse(readFileSync("fixtures/surf/labels-12payees.json", "utf8")) as { envelope: { data: AuditRaw["labels"] } }).envelope.data;
const U = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("audit sample", () => {
  const rows = [
    { resource: "https://a.example/x", serviceName: "A", network: "eip155:8453", payTo: "0x" + "a".repeat(40), amount: "1000", asset: U },
    { resource: "https://a.example/y", serviceName: "A", network: "eip155:8453", payTo: "0x" + "a".repeat(40), amount: "2000", asset: U },
    { resource: "https://b.example/x", serviceName: "B", network: "eip155:8453", payTo: "0x" + "b".repeat(40), amount: "5000", asset: U },
    { resource: "https://c.example/x", serviceName: "C", network: "solana", payTo: "So1ana", amount: "1", asset: "x" },
  ];
  it("dedupes Base payees, computes endpoints->payees ratio, ignores non-Base", () => {
    const s = buildSample(rows, 10);
    expect(s.catalog).toMatchObject({ resources: 4, base_resources: 3, distinct_base_payees: 2, endpoints_per_payee: 1.5 });
    expect(s.payees).toHaveLength(2);
  });
  it("is reproducible and independent of catalog order", () => {
    expect(buildSample([...rows].reverse(), 1).payees[0]!.payee).toBe(buildSample(rows, 1).payees[0]!.payee);
  });
});

describe("signalsFromSurf", () => {
  const now = 1794150000;
  it("maps a real row; token-contract funder becomes missing", () => {
    const r = smoke.rows.find((x) => x.payee.startsWith("0x480cd46e"))!; // first_inbound_from = USDC contract
    const s = signalsFromSurf(r, { now, windowStart: now - 365 * 86400, tokenContracts: [U] });
    expect(s.first_funder).toBeNull();
    expect(s.tx_count).toBe((r.inbound_count ?? 0) + (r.outbound_count ?? 0));
  });
  it("payee with no rows -> all activity missing (silence), not zeros", () => {
    const s = signalsFromSurf({ payee: "0x" + "c".repeat(40) }, { now, windowStart: now - 365 * 86400, tokenContracts: [] });
    expect([s.wallet_age_hours, s.tx_count, s.distinct_payers]).toEqual([null, null, null]);
  });
});

describe("audit report (dry run on the real 12-payee data, 0 credits)", () => {
  const sample = buildSample(
    smoke.rows.map((r) => ({ resource: `https://${r.payee.slice(2, 8)}.example/`, serviceName: null, network: "eip155:8453", payTo: r.payee, amount: "1000", asset: U })),
    200,
  );
  const md = auditReport(sample, { ran_at: "2026-11-08T16:24:30Z", days: 365, rows: smoke.rows, funder_rows: [], labels });
  it("has every required section", () => {
    for (const h of ["endpoints → payees ratio", "Wallet age (lower bound", "Funder clusters (exchanges excluded)", "Policy bands", "Caveats"]) expect(md).toContain(h);
  });
  it("finds the apitoll shared-funder cluster and counts CEX exclusion by label", () => {
    expect(md).toMatch(/0x5609e4…60f6 \| 2 \| no/);
    expect(md).toMatch(/by Surf `entity_type: cex` label/);
  });
  it("counts the laso.finance payee as floored at the window start", () => {
    expect(md).toMatch(/floored at window start\) \| [1-9]/);
  });
});
