/**
 * Every census receipt ever published keeps verifying by id, with its link checked inside its own chain.
 * Regression (found 2026-11-24): serving the 20 Nov refresh, the 13 Nov receipts were missing (one cache slot for all
 * older refreshes) and the 17 Nov ones failed "prev_hash does not link" (linkage checked against the served chain).
 * The ids come from the live /v1/index.json snapshots taken before each refresh (artifacts/index-*.json).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { startServer } from "../src/api/server.js";
import { loadCensus } from "../src/census.js";
import { tmp } from "./helpers.js";

let server: Server;
let base = "";
const getJson = (path: string) =>
  new Promise<any>((ok, fail) => {
    const r = request(base + path, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => ok(JSON.parse(b)));
    });
    r.on("error", fail);
    r.end();
  });

const snapshot = (day: string) => (JSON.parse(readFileSync(join(ROOT, "artifacts", `index-${day}.json`), "utf8")) as { census_at: string; payees: { receipt_id: string }[] }).payees.map((p) => p.receipt_id);
/** first, last and a spread in between: enough to cover both ends of each chain without 1,923 requests */
const spread = (ids: string[]) => [...new Set([0, 1, 7, 100, 500, 999, ids.length - 2, ids.length - 1].map((i) => ids[i]!))];

beforeAll(async () => {
  process.env.FIANGSHI_DATA_DIR = tmp();
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 60_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("published census receipts keep verifying by id", () => {
  for (const day of ["2026-11-13", "2026-11-17"]) {
    it(`the receipts published by the census served on ${day} are all still known`, () => {
      const c = loadCensus();
      const ids = snapshot(day);
      expect(ids.filter((id) => !c.receipts.has(id))).toEqual([]);
    });
    it(`and they verify with chain_linkage verified (${day})`, async () => {
      for (const id of spread(snapshot(day))) {
        const v = await getJson(`/v1/verify?id=${id}`);
        expect([id.slice(0, 12), v.valid, v.chain_linkage, v.errors]).toEqual([id.slice(0, 12), true, "verified", []]);
      }
    });
  }
  it("the served census still verifies too", async () => {
    const c = loadCensus();
    for (const id of spread(c.ledger.map((r) => r.receipt_hash))) {
      const v = await getJson(`/v1/verify?id=${id}`);
      expect([v.valid, v.chain_linkage]).toEqual([true, "verified"]);
    }
  });
});
