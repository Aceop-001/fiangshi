/**
 * Fixture mode (FIANGSHI_REPLAY=1, the localhost-check default) with ZERO keys: recorded 402s and recorded SERV/Dolphin
 * replies go through the real parser, vows and receipt chain, and the only network touched is 127.0.0.1.
 * Every outbound primitive is wrapped; any non-loopback target is recorded (and refused).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http, { request, type Server } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import { demoXPayment } from "../src/adapters/x402.js";
import { startServer } from "../src/api/server.js";
import { tmp } from "./helpers.js";

const external: string[] = [];
const LOOP = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);
const hostOf = (a: unknown): string | null => {
  if (typeof a === "string" || a instanceof URL) {
    try {
      return new URL(String(a)).hostname;
    } catch {
      return null; // a path (local IPC)
    }
  }
  const o = a as { hostname?: string; host?: string; path?: string } | undefined;
  if (o?.path && !o.host && !o.hostname) return null;
  return o?.hostname ?? o?.host?.split(":")[0] ?? "localhost";
};
function guard<T extends (...a: any[]) => any>(obj: any, key: string, target: (args: any[]) => string | null) {
  const orig = obj[key] as T;
  obj[key] = function (this: unknown, ...args: any[]) {
    const h = target(args);
    if (h !== null && !LOOP.has(h)) {
      external.push(`${key} ${h}`);
      throw new Error(`fixture-mode test: external ${key} to ${h}`);
    }
    return orig.apply(this, args);
  };
  return () => (obj[key] = orig);
}

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const FROM = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const CLEAVE = "https://api.cleave.fi/x402/gas";
const TBS = "https://x402.tbs-digital.com/weather/current";
let server: Server;
let base = "";
const restores: (() => void)[] = [];

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request(base + path, { method: "GET", headers }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, body: b }));
    });
    r.on("error", reject);
    r.end();
  });
}

beforeAll(async () => {
  restores.push(
    guard(globalThis, "fetch", (a) => hostOf(a[0])),
    guard(http, "request", (a) => hostOf(a[0])),
    guard(http, "get", (a) => hostOf(a[0])),
    guard(https, "request", (a) => hostOf(a[0]) ?? "https"),
    guard(https, "get", (a) => hostOf(a[0]) ?? "https"),
    guard(net, "connect", (a) => (typeof a[0] === "number" ? (a[1] ?? "localhost") : hostOf(a[0]))),
    guard(net, "createConnection", (a) => (typeof a[0] === "number" ? (a[1] ?? "localhost") : hostOf(a[0]))),
    guard(tls, "connect", (a) => (typeof a[0] === "number" ? (a[1] ?? "localhost") : hostOf(a[0]) ?? "tls")),
    guard(dns, "lookup", (a) => String(a[0])),
  );
  Object.assign(process.env, {
    FIANGSHI_REPLAY: "1",
    FIANGSHI_OFFLINE: "1",
    MOCK_MODELS: "",
    SERV_REASONING_API_KEY: "",
    DOLPHIN_API_KEY: "",
    SURF_API_KEY: "",
    FIANGSHI_PAYTO: PAYTO,
    FIANGSHI_DATA_DIR: tmp(),
  });
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 30_000);
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  for (const r of restores.reverse()) r();
  process.env.FIANGSHI_REPLAY = "0";
});

describe("fixture mode: zero keys, loopback only", () => {
  it("cleave.fi -> V6 BLOCK at $0 with 0 model calls, marked mode:fixture", async () => {
    const r = await get(`/v1/check?url=${encodeURIComponent(CLEAVE)}`);
    const j = JSON.parse(r.body);
    expect(r.headers["x-fiangshi-mode"]).toBe("fixture");
    expect(j).toMatchObject({ mode: "fixture", band: "BLOCK", vow_fired: "null_payee", cost_usd: 0, model_calls: 0 });
  });
  it("TBS: 402 unpaid, then ALLOW from the recorded SERV + Dolphin replies (validated, not mocked)", async () => {
    const r402 = await get(`/v1/check?url=${encodeURIComponent(TBS)}`);
    expect(r402.status).toBe(402);
    const req = JSON.parse(r402.body).accepts[0];
    const r = await get(`/v1/check?url=${encodeURIComponent(TBS)}`, { "x-payment": demoXPayment(req, FROM) });
    const j = JSON.parse(r.body);
    expect(j).toMatchObject({ mode: "fixture", band: "ALLOW", settlement: "dry-run" });
    expect(j.model).toMatchObject({ serv: "ALLOW", degraded: false });
    expect(j.enrichment.status).toBe("complete");
    expect(j.receipt.model.verdict).toBe("ALLOW");
    expect(JSON.parse((await get(`/v1/verify?id=${j.receipt_id}`)).body).valid).toBe(true);
  });
  it("a URL with no recording fails closed (never falls through to the network)", async () => {
    const r = await get(`/v1/check?url=${encodeURIComponent("https://not-recorded.example/x")}`, {
      "x-payment": demoXPayment({ scheme: "exact", network: "eip155:8453", amount: "50000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: PAYTO, maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } }, FROM),
    });
    expect(JSON.parse(r.body).band).not.toBe("ALLOW");
  });
  it("no network call left 127.0.0.1", () => {
    expect(external).toEqual([]);
  });
});
