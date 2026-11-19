// H (post-deadline): the service's own payTo from Base logs. A separate block; the census claim is untouched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { startServer } from "../src/api/server.js";
import { signalsFromSurf } from "../src/adapters/surf.js";
import { policyBand } from "../src/policy.js";
import { SELF_PAYEE, SELF_PRICE_USD, rowFromLogs, selfCoverage, type SelfCoverageFile } from "../src/self-coverage.js";
import { tmp } from "./helpers.js";

const A = (n: number) => "0x" + String(n).padStart(40, "a");
const FUNDER = A(9);
const t = (day: number, h = 0) => new Date(Date.UTC(2026, 10, day, h)).toISOString();
const tr = (day: number, from: string, usd: number, i: number) => ({ block: 1000 + i, time: t(day, i), counterparty: from, usd, tx: "0x" + String(i).padStart(64, "0"), log_index: 0 });
// six inbound transfers from five payers, 13 to 15 Nov; one outbound
const FILE: SelfCoverageFile = {
  payee: SELF_PAYEE, chain: "eip155:8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", source: "base-logs", rpc: "test",
  as_of: t(19), window_days: 90, window_limited_by: null, archive_rpc: "test", prior_nonce: 0, prior_usdc: 0, window_start: new Date(Date.parse(t(19)) - 90 * 86_400_000).toISOString(), from_block: 1, to_block: 2, chunk_blocks: 50_000, rpc_calls: 0, has_code: false, nonce: 1,
  inbound: [tr(13, FUNDER, 1, 0), tr(13, A(1), 0.05, 1), tr(14, A(2), 0.05, 2), tr(14, A(2), 0.05, 3), tr(15, A(3), 0.15, 4), tr(15, A(4), 0.05, 5)],
  outbound: [{ ...tr(16, A(7), 0.5, 6) }],
};
const EMPTY_CENSUS = { payees: [] as { payee: string }[], signals: new Map(), funderLabels: {} };
const NOW = Date.parse(t(19, 1));

describe("selfCoverage (pure)", () => {
  it("counts the logs as the spec block says", () => {
    const b = selfCoverage(FILE, EMPTY_CENSUS, NOW, 72);
    expect(b).toMatchObject({ payee: SELF_PAYEE, inbound_transfers: 6, inbound_usd: 1.35, distinct_payers: 5, first_seen: t(13, 0), last_seen: t(16, 6), source: "base-logs", as_of: t(19), in_census: false });
  });
  it("is ranked by the census policy unchanged: same band as policyBand on the same row", () => {
    const b = selfCoverage(FILE, EMPTY_CENSUS, NOW, 72);
    const s = { ...signalsFromSurf(rowFromLogs(FILE), { now: Date.parse(FILE.as_of) / 1000, windowStart: Date.parse(FILE.window_start) / 1000, tokenContracts: [], identity: { claims_org: null, corroborated: null } }), funder_fanout: 0 };
    const r = policyBand(s, SELF_PRICE_USD, {}, "v2", 90 * 24);
    expect([b.issued_band, b.score, b.vows]).toEqual([r.band, r.score, r.fired]);
    expect(b.band).not.toBe("ALLOW"); // a 6-day-old wallet with 5 payers is not vouched for
  });
  it("kinship counts census payees that share its first funder", () => {
    const sig = (p: string) => ({ payee: p, first_funder: FUNDER }) as never;
    const census = { payees: [], signals: new Map([A(11), A(12), A(13)].map((p) => [p, sig(p)])), funderLabels: {} };
    const b = selfCoverage(FILE, census, NOW, 72);
    expect(b.vows).toContain("kinship");
    expect(b.band).toBe("BLOCK");
  });
  it("in_census is true only when the census really lists the address", () => {
    expect(selfCoverage(FILE, { ...EMPTY_CENSUS, payees: [{ payee: SELF_PAYEE.toLowerCase() }] }, NOW, 72).in_census).toBe(true);
  });
  it("old data is capped by the same stale rule as the census", () => {
    const b = selfCoverage(FILE, EMPTY_CENSUS, Date.parse(t(30)), 72);
    expect(b.band).not.toBe("ALLOW");
  });
});

describe("/v1/index.json keeps the census claim", () => {
  let server: Server;
  let base = "";
  const get = (p: string) =>
    new Promise<string>((ok, no) => {
      const r = request(base + p, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => ok(b));
      });
      r.on("error", no);
      r.end();
    });
  beforeAll(async () => {
    process.env.FIANGSHI_DATA_DIR = tmp();
    server = await startServer(0, "127.0.0.1");
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  }, 30_000);
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("payees_total stays 1923, coverage reads 1923 of 1923, and the self block sits outside payees", async () => {
    const j = JSON.parse(await get("/v1/index.json"));
    expect(j.payees_total).toBe(1923);
    expect(j.payees.length).toBe(1923);
    expect(j.coverage).toBe("1923 of 1923 Base payees");
    expect(j.payees.some((p: { payee: string }) => p.payee === SELF_PAYEE.toLowerCase())).toBe(false);
    expect(j.self_coverage).toMatchObject({ payee: SELF_PAYEE, source: "base-logs", in_census: false });
    expect(j.self_coverage.inbound_transfers).toBeGreaterThan(0);
  });
});
