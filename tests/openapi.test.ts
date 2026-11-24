/**
 * Task 4 (2026-11-24): /openapi.json describes every route, and the descriptions match what the routes really answer.
 * For every documented JSON route: the real status is one the document lists, every required field is present, and
 * (where the schema closes its properties) no undocumented field appears.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { startServer } from "../src/api/server.js";
import { loadCensus } from "../src/census.js";
import { RECEIPT_FIELDS } from "../src/openapi.js";
import { Receipt } from "../src/core/types.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";
import { tmp } from "./helpers.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
let server: Server;
let base = "";
let spec: any;
const get = (path: string) =>
  new Promise<{ status: number; type: string; text: string }>((ok, fail) => {
    const r = request(base + path, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), text: b }));
    });
    r.on("error", fail);
    r.end();
  });
const resolve = (s: any) => (s?.$ref ? spec.components.schemas[s.$ref.split("/").pop()] : s);

beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_PAYTO: PAYTO, FIANGSHI_DATA_DIR: tmp() });
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  spec = JSON.parse((await get("/openapi.json")).text);
}, 60_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("/openapi.json", () => {
  it("is OpenAPI 3.1 with only standard root keys", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec).sort()).toEqual(["components", "info", "openapi", "paths", "servers"]);
    expect(spec.servers[0].url).toBe(base);
  });
  it("the Receipt schema lists exactly the fields of the zod Receipt", () => {
    expect([...RECEIPT_FIELDS].sort()).toEqual(Object.keys(Receipt.shape).sort());
    expect(Object.keys(spec.components.schemas.Receipt.properties).sort()).toEqual(Object.keys(Receipt.shape).sort());
  });
  it("every route the server's own route list names is documented", () => {
    const src = readFileSync(join(ROOT, "src", "api", "server.ts"), "utf8");
    const listed = [...src.matchAll(/^ \*   GET (\/[^\s?]*)/gm)].map((m) => m[1]!.replace(/:id$/, "{id}").replace(/:addr\.svg$/, "{file}").replace(/:addr$/, "{address}"));
    expect(listed.length).toBeGreaterThan(15);
    for (const p of listed) expect(spec.paths, `route ${p} is not in /openapi.json`).toHaveProperty([p]);
  });
  it("every documented route answers with a documented status, and JSON bodies match their schema", async () => {
    const c = loadCensus();
    const id = c.ledger[0]!.receipt_hash;
    const payee = c.payees[0]!.payee;
    const concrete: Record<string, string> = {
      "/health": "/health",
      "/openapi.json": "/openapi.json",
      "/v1/index.json": "/v1/index.json",
      "/v1/census/status": "/v1/census/status",
      "/v1/preview": `/v1/preview?url=${encodeURIComponent("https://api.cleave.fi/x402/gas")}`,
      "/v1/check": `/v1/check?url=${encodeURIComponent("https://api.weatherly.example/v1/forecast")}`,
      "/v1/payee/{address}": `/v1/payee/${payee}`,
      "/v1/batch": `/v1/batch?url=${encodeURIComponent("https://api.weatherly.example/v1/forecast")}&url=${encodeURIComponent("https://api.cleave.fi/x402/gas")}`,
      "/v1/stats": "/v1/stats",
      "/docs": "/docs",
      "/judges": "/judges",
      "/guide": "/guide",
      "/connect": "/connect",
      "/cli": "/cli",
      "/pricing": "/pricing",
      "/architecture": "/architecture",
      "/report": "/report",
      "/legal": "/legal",
      "/v1/receipt/{id}": `/v1/receipt/${id}`,
      "/v1/receipts/{id}": `/v1/receipts/${id}`,
      "/v1/verify": `/v1/verify?id=${id}`,
      "/v1/badge/{file}": `/v1/badge/${payee}.svg`,
      "/": "/",
      "/check": "/check",
      "/receipt/{id}": `/receipt/${id}`,
    };
    expect(Object.keys(spec.paths).sort()).toEqual(Object.keys(concrete).sort());
    for (const [p, path] of Object.entries(concrete)) {
      const r = await get(path);
      const doc = spec.paths[p].get.responses[String(r.status)];
      expect(doc, `${path} answered ${r.status}, not documented`).toBeDefined();
      const media = Object.keys(doc.content ?? {})[0];
      if (media) expect(r.type, path).toContain(media);
      if (media !== "application/json") continue;
      const schema = resolve(doc.content[media].schema);
      if (schema.type !== "object" || !schema.properties) continue;
      const body = JSON.parse(r.text);
      for (const k of schema.required ?? []) expect(body, `${path}: required ${k}`).toHaveProperty(k);
      if (schema.additionalProperties === false) expect(Object.keys(body).filter((k) => !(k in schema.properties)), `${path}: undocumented fields`).toEqual([]);
    }
  });
});
