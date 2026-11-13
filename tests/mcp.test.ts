import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { request, type Server } from "node:http";
import { ROOT } from "../src/config.js";
import { startServer } from "../src/api/server.js";
import { handleMessage, TOOLS } from "../src/mcp/server.js";
import { tmp } from "./helpers.js";

const NULL_PAYEE_URL = "https://api.cleave.fi/x402/gas"; // its 402 names the zero address as payTo (recorded fixture)

let server: Server;
let base = "";
function getJson(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = request(base + path, { method: "GET" }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(b) }));
    });
    r.on("error", reject);
    r.end();
  });
}
beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_DATA_DIR: tmp() });
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 30_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("GET /v1/preview (free JSON twin of the /check page)", () => {
  it("a null payee is BLOCK at probe time, free, with a receipt id", async () => {
    const r = await getJson(`/v1/preview?url=${encodeURIComponent(NULL_PAYEE_URL)}`);
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe("BLOCK");
    expect(r.body.vow_fired).toBe("null_payee");
    expect(r.body.cost_usd).toBe(0);
    expect(r.body.receipt_id).toMatch(/^[0-9a-f]{64}$/);
    const v = await getJson(`/v1/verify?id=${r.body.receipt_id}`);
    expect(v.body.valid).toBe(true);
  });
  it("rejects a non-URL with 400 and never says ALLOW", async () => {
    const r = await getJson(`/v1/preview?url=not-a-url`);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain("ALLOW");
  });
});

describe("MCP protocol handler", () => {
  it("initialize answers with tools capability and echoes a known protocol version", async () => {
    const r = (await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, base)) as any;
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.serverInfo.name).toBe("fiangshi");
  });
  it("lists four tools, each with an object input schema", async () => {
    const r = (await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, base)) as any;
    expect(r.result.tools.map((t: any) => t.name)).toEqual(["fiangshi_preview", "fiangshi_check", "fiangshi_payee", "fiangshi_verify_receipt"]);
    for (const t of TOOLS) expect(t.inputSchema.type).toBe("object");
  });
  it("unknown method is -32601, unknown tool is -32602, notifications get no reply", async () => {
    expect(((await handleMessage({ jsonrpc: "2.0", id: 3, method: "nope" }, base)) as any).error.code).toBe(-32601);
    expect(((await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "pay_now" } }, base)) as any).error.code).toBe(-32602);
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, base)).toBeNull();
  });
  it("a bad argument is a tool error, not a crash", async () => {
    const r = (await handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "fiangshi_payee", arguments: { address: "bob" } } }, base)) as any;
    expect(r.result.isError).toBe(true);
  });
  it("an unreachable Fiangshi is a tool error naming the base URL", async () => {
    const r = (await handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "fiangshi_preview", arguments: { url: NULL_PAYEE_URL } } }, "http://127.0.0.1:1")) as any;
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("could not reach Fiangshi");
  });
  it("fiangshi_payee returns the census record of a listed payee", async () => {
    const idx = await getJson("/v1/index.json");
    const p = idx.body.payees[0];
    const r = (await handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "fiangshi_payee", arguments: { address: p.payee } } }, base)) as any;
    expect(JSON.parse(r.result.content[0].text).band).toBe(p.band);
  });
});

describe("MCP over stdio (spawned process)", () => {
  let child: ChildProcessWithoutNullStreams;
  const replies: any[] = [];
  let buf = "";
  const waitFor = (id: number) =>
    new Promise<any>((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const hit = replies.find((r) => r.id === id);
        if (hit) return resolve(hit);
        if (Date.now() - t0 > 20_000) return reject(new Error(`no reply for id ${id}`));
        setTimeout(tick, 25);
      };
      tick();
    });
  beforeAll(() => {
    child = spawn(process.execPath, ["--import", "tsx", join(ROOT, "src", "mcp", "server.ts")], { cwd: ROOT, env: { ...process.env, FIANGSHI_URL: base } });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) replies.push(JSON.parse(line));
      }
    });
  });
  afterAll(() => void child.kill());
  const send = (m: object) => child.stdin.write(JSON.stringify(m) + "\n");

  it("handshake, list, and a free BLOCK through the real tool, stdout carries JSON-RPC only", async () => {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    expect((await waitFor(1)).result.serverInfo.name).toBe("fiangshi");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((await waitFor(2)).result.tools).toHaveLength(4);
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fiangshi_preview", arguments: { url: NULL_PAYEE_URL } } });
    const out = JSON.parse((await waitFor(3)).result.content[0].text);
    expect(out.verdict).toBe("BLOCK");
    send("not json" as unknown as object);
    for (const r of replies) expect(r.jsonrpc).toBe("2.0");
  }, 30_000);
});
