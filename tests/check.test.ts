import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { join } from "node:path";
import { check } from "../src/check.js";
import { buildSnapshot } from "../src/snapshot.js";
import { indexHtml, indexRows } from "../src/indexpage.js";
import { verifyChain } from "../src/core/receipt.js";
import { readLedger } from "../src/ledger/store.js";
import type { Snapshot } from "../src/core/types.js";
import { tmp } from "./helpers.js";

let snap: Snapshot;
beforeAll(async () => {
  snap = (await buildSnapshot()).snapshot;
});
afterEach(() => {
  process.env.MOCK_MODELS = "good";
});

const cases: [string, string, string | undefined][] = [
  ["https://api.weatherly.example/v1/forecast", "ALLOW", undefined],
  ["https://fresh-oracle.example/v1/price", "BLOCK", "age"],
  ["https://swarm-a.example/v1/search", "BLOCK", "kinship"],
  ["https://weatherly-official.example/v1/forecast", "BLOCK", "identity"],
  ["https://premium-signals.example/v1/alpha", "REVIEW", "history"],
  ["https://unknown-seller.example/v1/data", "REVIEW", "silence"],
];

describe("check (offline, end to end)", () => {
  for (const [url, band, vow] of cases)
    it(`${url} -> ${band}${vow ? ` (${vow})` : ""}`, async () => {
      process.env.MOCK_MODELS = "good";
      const r = await check(url, { snapshot: snap, ledger: false });
      expect(r.decision.verdict.band).toBe(band);
      expect(r.decision.verdict.vow_fired).toBe(vow);
    });

  it("unrecorded URL offline -> probe error -> REVIEW, never ALLOW", async () => {
    const r = await check("https://not-recorded.example", { snapshot: snap, ledger: false });
    expect(r.probe_error).toMatch(/no 402 fixture/);
    expect(r.decision.verdict.band).toBe("REVIEW");
  });

  it("MOCK_MODELS=allow cannot beat a vow", async () => {
    process.env.MOCK_MODELS = "allow";
    const r = await check("https://fresh-oracle.example/v1/price", { snapshot: snap, ledger: false });
    expect(r.decision.modelRawBand).toBe("ALLOW");
    expect(r.decision.verdict.band).toBe("BLOCK");
  });

  it("MOCK_MODELS=broken -> REVIEW, degraded=true, even for a clean payee", async () => {
    process.env.MOCK_MODELS = "broken";
    const r = await check("https://api.weatherly.example/v1/forecast", { snapshot: snap, ledger: false });
    expect(r.decision.verdict).toMatchObject({ band: "REVIEW", degraded: true });
    expect(r.receipt.model.degraded).toBe(true);
  });

  it("receipts chain across checks and verify", async () => {
    const path = join(tmp(), "ledger.jsonl");
    for (const [url] of cases) await check(url, { snapshot: snap, ledger: path });
    expect(verifyChain(readLedger(path)).ok).toBe(true);
  });
});

describe("index", () => {
  it("lists >= 25 payees, contains no script, escapes HTML", () => {
    const html = indexHtml(snap, []);
    expect(indexRows(snap, []).length).toBeGreaterThanOrEqual(25);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});
