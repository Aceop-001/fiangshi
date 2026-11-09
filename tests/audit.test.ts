import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditReport, buildSample, creditsUsedTodayUtc, shapeOf, type ReportInputs } from "../scripts/audit.js";
import { signalsFromSurf, type SurfPayeeRow, type SurfWalletLabel } from "../src/adapters/surf.js";
import { tmp } from "./helpers.js";

const smoke = JSON.parse(readFileSync("fixtures/surf/smoke-12payees.json", "utf8")) as { rows: SurfPayeeRow[] };
const labels = (JSON.parse(readFileSync("fixtures/surf/labels-12payees.json", "utf8")) as { envelope: { data: SurfWalletLabel[] } }).envelope.data;
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
    const r = smoke.rows.find((x) => x.payee.startsWith("0x480cd46e"))!;
    const s = signalsFromSurf(r, { now, windowStart: now - 365 * 86400, tokenContracts: [U] });
    expect(s.first_funder).toBeNull();
    expect(s.tx_count).toBe((r.inbound_count ?? 0) + (r.outbound_count ?? 0));
  });
  it("payee with no rows -> all activity missing (silence), not zeros", () => {
    const s = signalsFromSurf({ payee: "0x" + "c".repeat(40) }, { now, windowStart: now - 365 * 86400, tokenContracts: [] });
    expect([s.wallet_age_hours, s.tx_count, s.distinct_payers, s.top_payer_share]).toEqual([null, null, null, null]);
  });
  it("passes top_payer_share through for E v2", () => {
    const s = signalsFromSurf({ payee: "0x" + "d".repeat(40), first_inbound_at: now - 9e6, inbound_count: 5, distinct_inbound_senders: 3, top_payer_share: 0.42 }, { now, windowStart: now - 365 * 86400, tokenContracts: [] });
    expect(s.top_payer_share).toBe(0.42);
  });
});

describe("free-tier credit accounting", () => {
  it("sums only today's surf rows from costs.md", () => {
    const p = join(tmp(), "costs.md");
    writeFileSync(p, ["| time | provider | label | call | units | status |", "| 2026-11-08T01:00:00Z | surf | x | 1/60 | 5 | ok |", "| 2026-11-08T02:00:00Z | surf | y | 2/60 | 1 | ok |", "| 2026-11-07T23:00:00Z | surf | z | 3/60 | 5 | ok |", "| 2026-11-08T03:00:00Z | serv | m | 1/100 | 900 | ok |"].join("\n"));
    expect(creditsUsedTodayUtc(p, "2026-11-08")).toBe(6);
  });
});

describe("shapeOf (unparseable 402 description)", () => {
  it("names body keys and payment headers without interpreting them", () => {
    expect(shapeOf({ status: 402, headers: { "www-authenticate": "L402 x" }, body: { error: "pay", price: 1 } })).toBe("JSON keys {error, price}; payment headers [www-authenticate]");
    expect(shapeOf({ status: 402, headers: {}, body: "" })).toBe("empty body; payment headers [none]");
  });
});

describe("audit report (dry run on the real 12-payee data, 0 credits)", () => {
  const sample = buildSample(
    smoke.rows.map((r) => ({ resource: `https://${r.payee.slice(2, 8)}.example/`, serviceName: null, network: "eip155:8453", payTo: r.payee, amount: "1000", asset: U })),
    200,
  );
  const inp: ReportInputs = {
    sample,
    cp: { payee_rows: Object.fromEntries(smoke.rows.map((r) => [r.payee, r])), funder_rows: [], labels, labels_done: Array(23).fill("x"), calls: [{ label: "onchain-sql payee-inbound payees=12", ms: 4412, credits: 5, at: "2026-11-08T16:24:26Z" }], stopped: null, mode: "sync" },
    ranAt: "2026-11-08T16:24:30Z",
    probes: [{ status: 402, parsed: true, payee_matches_catalog: true }, { status: 405, parsed: false }],
    unparsed: [{ url: "https://x.example/p", shape: "HTTP 402; empty body; payment headers [none]" }],
    knownPair: { funder: "0x5609e41fbd5dc6184ccbd161eafff1060b7660f6", payees: [{ payee: "0x3da40a9ad36640a2c0f533bac368490095574664", host: "crypto.apitoll.cloud" }, { payee: "0x58bdad5e654691ac5ed4631758f3d8da00666b6c", host: "edgar.apitoll.cloud" }] },
  };
  const md = auditReport(inp);
  it("has every required section and a buyer sentence per finding", () => {
    for (const h of ["## Method", "## Census", "coverage", "LOWER BOUNDS", "Funder clusters (exchanges excluded)", "## Live probes", "unparseable 402 shapes", "## Labels", "6 of 23 (26.1%)", "Metering", "## Billing (measured)", "| 4 |", "Policy bands (E v2", "E v1 → v2"]) expect(md).toContain(h);
    expect((md.match(/\*For a buyer:\*/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
  it("names the apitoll pair and the in-sample shared-funder cluster", () => {
    expect(md).toContain("crypto.apitoll.cloud");
    expect(md).toContain("edgar.apitoll.cloud");
    expect(md).toMatch(/0x5609e4…60f6 \| 2 \| no/);
  });
  it("counts the laso.finance payee as floored and reports coverage", () => {
    expect(md).toMatch(/established: first transfer at the window start\) \| [1-9]/);
    expect(md).toContain("12 of 12 Base payees (100.0%), 365-day window");
  });
});

import { checkGate, GATE_PAYEES, isStopError } from "../scripts/audit.js";

describe("paid gate (top_payer_share sanity on 5 payees)", () => {
  const rows = (vals: (number | null | undefined)[]) => GATE_PAYEES.map((p, i) => (vals[i] === undefined ? { payee: p } : { payee: p, top_payer_share: vals[i] }));
  it("passes on five finite floats in [0,1], not all 1.0", () => {
    expect(checkGate(rows([0.12, 0.5, 1, 0.33, 0.9])).ok).toBe(true);
  });
  it("fails when any value is null or missing", () => {
    expect(checkGate(rows([0.1, null, 0.2, 0.3, 0.4])).reasons.join()).toMatch(/null/);
    expect(checkGate(rows([0.1, undefined, 0.2, 0.3, 0.4])).reasons.join()).toMatch(/undefined/);
    expect(checkGate(rows([0.1, 0.2, 0.3, 0.4]).slice(0, 4)).ok).toBe(false); // a payee row absent
  });
  it("fails when a value is outside [0,1]", () => {
    expect(checkGate(rows([0.1, 1.2, 0.2, 0.3, 0.4])).ok).toBe(false);
  });
  it("fails when all five are exactly 1.0 (not discriminating)", () => {
    expect(checkGate(rows([1, 1, 1, 1, 1])).reasons.join()).toMatch(/all five/);
  });
  it("gate payees are real recorded payees, lowercase, distinct", () => {
    expect(new Set(GATE_PAYEES).size).toBe(5);
    for (const p of GATE_PAYEES) expect(p).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe("Surf refusals stop an unattended run (no retry)", () => {
  it("classifies the refusal seen at 2026-11-09 02:01 as a stop", () => {
    expect(isStopError("SQL_QUERY_IN_FLIGHT: an equivalent synchronous query is already running")).toBe(true);
    expect(isStopError("QUERY_TIMEOUT: terminated at 30s")).toBe(true);
    expect(isStopError("serv: HTTP 429")).toBe(true);
    expect(isStopError("exit_1: something else")).toBe(false);
  });
});
