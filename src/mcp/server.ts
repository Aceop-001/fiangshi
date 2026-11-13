/**
 * Fiangshi MCP server (Model Context Protocol, stdio transport). No dependencies: JSON-RPC 2.0, one message per line.
 * It is a thin client of a running Fiangshi HTTP server (FIANGSHI_URL, default http://127.0.0.1:8787), so any MCP client
 * (Claude Code, Claude Desktop, Codex, Grok CLI, Hermes, Cursor, VS Code, ...) can ask "should I pay this?".
 *
 * Tools
 *   fiangshi_preview         free: unpaid probe + null-payee gate + census answer (GET /v1/preview)
 *   fiangshi_check           the paid check: a free BLOCK for a null payee, otherwise the x402 payment terms to pay
 *   fiangshi_payee           free: the census record for one wallet (from GET /v1/index.json)
 *   fiangshi_verify_receipt  free: recompute a receipt's hash and chain link (GET /v1/verify)
 *
 * It never pays, signs or holds anything: fiangshi_check returns the 402 terms and the agent's own x402 client pays.
 * Run:  npx tsx src/mcp/server.ts        (logs go to stderr; stdout carries protocol messages only)
 */
import { request } from "node:http";
import { request as httpsRequest } from "node:https";
import { createInterface } from "node:readline";

export const SERVER_INFO = { name: "fiangshi", version: "0.1.0" };
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const BASE = (process.env.FIANGSHI_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

const urlArg = { type: "object", properties: { url: { type: "string", description: "The x402 paid endpoint URL, starting with http:// or https://" } }, required: ["url"], additionalProperties: false };
export const TOOLS = [
  {
    name: "fiangshi_preview",
    description:
      "Free pre-payment check of an x402 paid endpoint. Makes one unpaid request, blocks a dead-end payment address (zero address, burn address, token contract, bad checksum) at no cost, and returns the census answer for the wallet that would be paid: ALLOW, REVIEW, BLOCK, or no_record. Call this before paying any x402 endpoint. Treat REVIEW and no_record as 'ask a human or cap the amount', never as ALLOW.",
    inputSchema: urlArg,
  },
  {
    name: "fiangshi_check",
    description:
      "The full, paid Fiangshi check of an x402 endpoint (verdict, quoted evidence, model advice, sealed receipt). A dead-end payment address is answered BLOCK for free. Otherwise this returns Fiangshi's own x402 payment terms (price, payTo, asset): pay them with your x402 client and send the X-PAYMENT header to the returned URL. This tool never pays.",
    inputSchema: urlArg,
  },
  {
    name: "fiangshi_payee",
    description: "Free: the census record (band, score, rules fired, receipt id) for one payee wallet on Base, if it is in the census.",
    inputSchema: { type: "object", properties: { address: { type: "string", description: "0x-prefixed Base wallet address" } }, required: ["address"], additionalProperties: false },
  },
  {
    name: "fiangshi_verify_receipt",
    description: "Free: verify a Fiangshi receipt by its id. Recomputes the sha256 hash and the chain link; valid is false if anything was changed.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "64-character hex receipt id" } }, required: ["id"], additionalProperties: false },
  },
];

/** GET a Fiangshi URL with node:http(s) (not fetch), returning status and parsed JSON. */
export function getJson(url: string, timeoutMs = 60_000): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith("https:") ? httpsRequest : request)(url, { method: "GET", headers: { accept: "application/json" }, timeout: timeoutMs }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(b) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: { error: "Fiangshi answered with something that is not JSON", text: b.slice(0, 200) } });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Fiangshi did not answer within ${timeoutMs / 1000} s`)));
    req.on("error", reject);
    req.end();
  });
}

const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\/\S{1,2000}$/i.test(u);

/** Run one tool. Returns the MCP result shape: text content, and isError for failures the agent should see. */
export async function callTool(name: string, args: Record<string, unknown>, base = BASE): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const out = (v: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }], ...(isError ? { isError: true } : {}) });
  try {
    if (name === "fiangshi_preview") {
      if (!isHttpUrl(args.url)) return out({ error: "url must start with http:// or https://" }, true);
      const r = await getJson(`${base}/v1/preview?url=${encodeURIComponent(args.url)}`);
      return out(r.body, r.status >= 400);
    }
    if (name === "fiangshi_check") {
      if (!isHttpUrl(args.url)) return out({ error: "url must start with http:// or https://" }, true);
      const target = `${base}/v1/check?url=${encodeURIComponent(args.url)}`;
      const r = await getJson(target);
      if (r.status === 402)
        return out({ payment_required: true, pay_to_call: target, how: "Pay these x402 terms with your own x402 client, then GET pay_to_call again with the X-PAYMENT header. Fiangshi never pays for you.", terms: r.body });
      return out(r.body, r.status >= 400);
    }
    if (name === "fiangshi_payee") {
      const a = String(args.address ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(a)) return out({ error: "address must be a 0x-prefixed 40-hex-character address" }, true);
      const r = await getJson(`${base}/v1/index.json`);
      const list = (r.body as { payees?: { payee: string }[] }).payees ?? [];
      const hit = list.find((p) => p.payee === a);
      return out(hit ?? { address: a, in_census: false, note: "Not in the census. Use fiangshi_preview or fiangshi_check on one of its endpoints." });
    }
    if (name === "fiangshi_verify_receipt") {
      const id = String(args.id ?? "");
      if (!/^[0-9a-f]{64}$/.test(id)) return out({ error: "id must be a 64-character lowercase hex receipt id" }, true);
      const r = await getJson(`${base}/v1/verify?id=${id}`);
      return out(r.body, r.status >= 400);
    }
    return out({ error: `unknown tool ${name}` }, true);
  } catch (e) {
    return out({ error: `could not reach Fiangshi at ${base}: ${(e as Error).message}. Is the server running (npm run dev)?` }, true);
  }
}

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Handle one JSON-RPC message; returns the response to write, or null for notifications. */
export async function handleMessage(m: Msg, base = BASE): Promise<Record<string, unknown> | null> {
  const isRequest = m.id !== undefined && m.id !== null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return isRequest ? fail(-32600, "invalid request") : null;
  switch (m.method) {
    case "initialize": {
      const asked = String((m.params as { protocolVersion?: string } | undefined)?.protocolVersion ?? "");
      return reply({ protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: "Call fiangshi_preview before paying any x402 endpoint. Only ALLOW means go ahead; REVIEW and no_record mean ask a human or cap the amount; BLOCK means do not pay." });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const p = (m.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!TOOLS.some((t) => t.name === p.name)) return fail(-32602, `unknown tool: ${String(p.name)}`);
      return reply(await callTool(p.name!, p.arguments ?? {}, base));
    }
    default:
      if (m.method.startsWith("notifications/")) return null;
      return isRequest ? fail(-32601, `method not found: ${m.method}`) : null;
  }
}

/** stdio loop: one JSON message per line in, one per line out. */
export function serveStdio(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let m: Msg;
    try {
      m = JSON.parse(line) as Msg;
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
      return;
    }
    void handleMessage(m).then((r) => {
      if (r) process.stdout.write(JSON.stringify(r) + "\n");
    });
  });
  process.stderr.write(`fiangshi MCP server ready (talking to ${BASE})\n`);
}

if (process.argv[1] && /mcp[\\/]server\.(ts|js)$/.test(process.argv[1])) serveStdio();
