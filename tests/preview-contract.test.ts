import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { startServer } from "../src/api/server.js";
import { loadCensus } from "../src/census.js";
import { renderCheck } from "../src/site.js";
import { PREVIEW_KEYS, censusAnswer, decidingVow, freshness, noRecordAnswer, type PreviewAnswer, type Terms } from "../src/preview.js";
import { tmp } from "./helpers.js";

let server: Server;
let base = "";
const getJson = (path: string) =>
  new Promise<any>((resolve, reject) => {
    const r = request(base + path, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve(JSON.parse(b)));
    });
    r.on("error", reject);
    r.end();
  });
beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_DATA_DIR: tmp() });
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 30_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const TERMS: Terms = { price_usd: 0.01, network: "base", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", pay_to: "0xabc", terms_hash: "h" };
const SORTED = [...PREVIEW_KEYS].sort();

function shapeOk(a: PreviewAnswer | Record<string, unknown>, label: string) {
  const { mode: _mode, ...rest } = a as Record<string, unknown>;
  expect(Object.keys(rest).sort(), label).toEqual(SORTED);
  expect(Array.isArray(rest.vows_fired), `${label} vows_fired`).toBe(true);
  expect(typeof rest.cost_usd, `${label} cost_usd`).toBe("number");
  expect(rest.vow_fired === null || typeof rest.vow_fired === "string", `${label} vow_fired`).toBe(true);
  expect(Array.isArray(rest.unknowns), `${label} unknowns`).toBe(true);
  if (rest.vow_fired) expect(rest.vows_fired, label).toContain(rest.vow_fired);
}

describe("GET /v1/preview: one schema on every path", () => {
  it("null payee (probe time) and probe failure, over HTTP", async () => {
    const block = await getJson(`/v1/preview?url=${encodeURIComponent("https://api.cleave.fi/x402/gas")}`);
    shapeOk(block, "null_payee");
    expect(block.vow_fired).toBe("null_payee");
    expect(block.cost_usd).toBe(0);
    const failed = await getJson(`/v1/preview?url=${encodeURIComponent("https://example.invalid/paid")}`);
    shapeOk(failed, "no_verdict");
    expect(failed.verdict).toBe("no_verdict");
  });
  it("census record and no record", () => {
    const c = loadCensus();
    const kin = c.payees.find((p) => p.vows.includes("kinship"))!;
    const census = censusAnswer(kin.url, TERMS, c, kin, { ok: false, why: "off" });
    shapeOk(census, "census");
    expect(census.vow_fired).toBe("kinship"); // a client reading vow_fired no longer misses kinship blocks
    shapeOk(noRecordAnswer("https://x.example", TERMS, c, { ok: false, why: "off" }), "no_record");
  });
  it("a dead paid route is never advertised as a link", async () => {
    delete process.env.FIANGSHI_PAYTO;
    const c = loadCensus();
    const a = censusAnswer(c.payees[0]!.url, TERMS, c, c.payees[0]!, { ok: false, why: "no wallet" });
    expect(a.paid_check).toBeNull();
    expect(a.paid_check_status).toMatch(/^disabled: /);
    const live = await getJson(`/v1/preview?url=${encodeURIComponent("https://example.invalid/paid")}`);
    expect(live.paid_check).toBeNull();
  });
  it("the census answer says how old it is, and that past 72 hours it is stale", () => {
    const c = loadCensus();
    const fresh = censusAnswer(c.payees[0]!.url, TERMS, c, c.payees[0]!, { ok: false, why: "x" }, new Date(Date.parse(c.payees[0]!.as_of) + 3_600_000));
    expect(fresh.data_age_hours).toBe(1);
    expect(fresh.stale).toBe(false);
    const old = censusAnswer(c.payees[0]!.url, TERMS, c, c.payees[0]!, { ok: false, why: "x" }, new Date(Date.parse(c.payees[0]!.as_of) + 96 * 3_600_000));
    expect(old.stale).toBe(true);
    expect(old.unknowns.join(" ")).toContain("past the 72-hour freshness window");
    expect(freshness(c.at, new Date(Date.parse(c.at) + 72 * 3_600_000)).stale).toBe(false);
  });
  it("an unnamed shared funder is listed as unknown, never hidden", () => {
    const c = loadCensus();
    const kin = c.payees.find((p) => p.vows.includes("kinship") && c.funders.some((f) => f.funder === p.first_funder && f.status === "shared unnamed funder"))!;
    const a = censusAnswer(kin.url, TERMS, c, kin, { ok: false, why: "x" });
    expect(a.unknowns[0]).toMatch(/^who the first funder 0x[0-9a-f]{40} is: it funded \d+ catalog sellers and Surf has no label/);
  });
  it("the deciding vow follows the frozen precedence", () => {
    expect(decidingVow(["silence", "kinship"])).toBe("kinship");
    expect(decidingVow([])).toBeNull();
  });
  it("the check page shows what could not be checked, and never offers a paid check that is switched off", () => {
    delete process.env.FIANGSHI_PAYTO;
    const c = loadCensus();
    const p = c.payees.find((x) => x.vows.includes("kinship"))!;
    const terms = { url: p.url, price: p.price_usd, asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", network: "base", payee: p.payee, terms_hash: "a".repeat(64) };
    const html = renderCheck({ kind: "census", url: p.url, terms, payTo: p.payee, payee: p }, c, "https://api.fiangshi.xyz", null);
    expect(html).toContain("What we could not check");
    expect(html).toContain("Surf has no label");
    expect(html).toContain("The paid check is not enabled on this server");
    expect(html).not.toContain('curl -i "https://api.fiangshi.xyz/v1/check');
    expect(html).toContain('curl "https://api.fiangshi.xyz/v1/preview?url=');
  });
});
