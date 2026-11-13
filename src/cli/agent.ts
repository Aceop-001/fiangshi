/**
 * The agent-facing half of the Fiangshi CLI: thin commands over a running Fiangshi server (FIANGSHI_URL, default
 * http://127.0.0.1:8787), built for scripts and AI agents. Every command prints JSON with --json, and the exit code
 * carries the verdict so an agent can branch without parsing:
 *
 *   0  ALLOW     go ahead
 *   10 REVIEW    ask a human or lower the amount (also no_record and no_verdict: never treat them as ALLOW)
 *   20 BLOCK     do not pay
 *   1  error     Fiangshi could not be reached or answered with an error
 *   2  usage     wrong arguments
 *
 * Nothing here pays, signs or holds money. `quote` shows Fiangshi's own price for the paid check; your x402 client pays.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "../config.js";
import { getJson } from "../mcp/server.js";

export const EXIT = { ALLOW: 0, REVIEW: 10, BLOCK: 20, ERROR: 1, USAGE: 2 } as const;

export const base = () => (process.env.FIANGSHI_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const isUrl = (u: string | undefined): u is string => typeof u === "string" && /^https?:\/\/\S{1,2000}$/i.test(u);

/** The exit code for a verdict word. Anything that is not exactly ALLOW or BLOCK is REVIEW (fail closed). */
export function exitFor(verdict: unknown): number {
  return verdict === "ALLOW" ? EXIT.ALLOW : verdict === "BLOCK" ? EXIT.BLOCK : EXIT.REVIEW;
}

const NEXT: Record<number, string> = {
  [EXIT.ALLOW]: "go ahead: no rule fired and the evidence is strong (valid for 72 h)",
  [EXIT.REVIEW]: "ask a human, or lower the amount. Do not treat this as ALLOW.",
  [EXIT.BLOCK]: "do not pay",
};

type Out = { code: number; json: unknown; text: string };

function kv(rows: [string, unknown][]): string {
  return rows
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `  ${k.padEnd(9)} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}

async function call(path: string): Promise<{ status: number; body: Record<string, unknown> } | Out> {
  try {
    const r = await getJson(base() + path);
    return { status: r.status, body: (r.body ?? {}) as Record<string, unknown> };
  } catch (e) {
    const msg = `could not reach Fiangshi at ${base()}: ${(e as Error).message}. Start it with npm run dev, or set FIANGSHI_URL.`;
    return { code: EXIT.ERROR, json: { error: msg }, text: `error: ${msg}` };
  }
}
const failed = (r: unknown): r is Out => typeof r === "object" && r !== null && "code" in r;

export async function preview(url: string | undefined): Promise<Out> {
  if (!isUrl(url)) return { code: EXIT.USAGE, json: { error: "pass an http(s) URL" }, text: "usage: fiangshi preview <url>" };
  const r = await call(`/v1/preview?url=${encodeURIComponent(url)}`);
  if (failed(r)) return r;
  if (r.status >= 400) return { code: EXIT.ERROR, json: r.body, text: `error: ${String(r.body.error ?? r.status)}` };
  const b = r.body;
  const code = exitFor(b.verdict);
  const terms = (b.terms ?? {}) as Record<string, unknown>;
  const text = `${String(b.verdict).toUpperCase()}  ${url.replace(/^https?:\/\//, "")}\n${kv([
    ["source", b.source],
    ["score", b.score],
    ["rule", b.vow_fired ?? (Array.isArray(b.vows_fired) && b.vows_fired.length ? (b.vows_fired as string[]).join(", ") : undefined)],
    ["reason", b.reason],
    ["price", terms.price_usd !== undefined ? `$${terms.price_usd} on ${terms.network}` : undefined],
    ["pay to", terms.pay_to],
    ["receipt", b.receipt_id],
    ["next", NEXT[code]],
  ])}`;
  return { code, json: { ...b, exit_code: code, next: NEXT[code] }, text };
}

export async function payee(address: string | undefined): Promise<Out> {
  const a = (address ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return { code: EXIT.USAGE, json: { error: "pass a 0x address" }, text: "usage: fiangshi payee <0x address>" };
  const r = await call("/v1/index.json");
  if (failed(r)) return r;
  const hit = ((r.body.payees ?? []) as { payee: string; band?: string; score?: number; vows?: string[]; url?: string; receipt_id?: string }[]).find((p) => p.payee === a);
  if (!hit) return { code: EXIT.REVIEW, json: { address: a, in_census: false, exit_code: EXIT.REVIEW, next: NEXT[EXIT.REVIEW] }, text: `NO RECORD  ${a}\n  next      not in the census: run fiangshi preview on one of its endpoints, or the paid check` };
  const code = exitFor(hit.band);
  return { code, json: { ...hit, exit_code: code, next: NEXT[code] }, text: `${hit.band}  ${a}\n${kv([["score", hit.score], ["rules", hit.vows?.join(", ") || "none"], ["endpoint", hit.url], ["receipt", hit.receipt_id], ["next", NEXT[code]]])}` };
}

export async function receipt(id: string | undefined): Promise<Out> {
  if (!/^[0-9a-f]{64}$/.test(id ?? "")) return { code: EXIT.USAGE, json: { error: "pass a 64-character hex receipt id" }, text: "usage: fiangshi receipt <id>" };
  const r = await call(`/v1/verify?id=${id}`);
  if (failed(r)) return r;
  const valid = r.body.valid === true;
  return { code: valid ? 0 : EXIT.ERROR, json: r.body, text: `${valid ? "VALID" : "INVALID"}  receipt ${id!.slice(0, 16)}…\n${kv([["reason", r.body.reason ?? r.body.error], ["chain", r.body.chain]])}` };
}

export async function quote(url: string | undefined): Promise<Out> {
  if (!isUrl(url)) return { code: EXIT.USAGE, json: { error: "pass an http(s) URL" }, text: "usage: fiangshi quote <url>" };
  const target = `/v1/check?url=${encodeURIComponent(url)}`;
  const r = await call(target);
  if (failed(r)) return r;
  if (r.status === 402) {
    const json = { payment_required: true, pay_to_call: base() + target, terms: r.body, how: "pay with your own x402 client and call pay_to_call again with the X-PAYMENT header" };
    return { code: EXIT.REVIEW, json, text: `PAYMENT REQUIRED for the full check\n${kv([["call", base() + target], ["terms", (r.body as { accepts?: unknown[] }).accepts?.[0] ?? r.body], ["how", json.how]])}` };
  }
  const b = r.body;
  const band = b.band ?? b.verdict;
  return { code: exitFor(band), json: b, text: `${String(band)}  (answered without payment)\n${kv([["rule", b.vow_fired], ["reason", b.reason], ["receipt", b.receipt_id]])}` };
}

export const SKILL_TARGETS: Record<string, { user: string; project?: string; note: string }> = {
  claude: { user: join(homedir(), ".claude", "skills"), project: join(".claude", "skills"), note: "Claude Code loads it in the next session; type /fiangshi or just ask before paying." },
  codex: { user: join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills"), project: join(".codex", "skills"), note: "Codex picks it up in a new session." },
  grok: { user: join(homedir(), ".grok", "skills"), project: join(".grok", "skills"), note: "Grok CLI picks it up in a new session." },
  hermes: { user: join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "hermes", "skills", "finance"), note: "Hermes: run hermes skills list to see it." },
};

/** Copy skills/fiangshi into an agent's skills folder. Writes only that one folder; never overwrites without --force. */
export function installSkill(target: string | undefined, opts: { project?: boolean; force?: boolean; dir?: string }): Out {
  const t = SKILL_TARGETS[target ?? ""];
  if (!t) return { code: EXIT.USAGE, json: { error: "target must be claude, codex, grok or hermes" }, text: `usage: fiangshi skill install <${Object.keys(SKILL_TARGETS).join("|")}> [--project] [--force]` };
  const root = opts.dir ?? (opts.project ? (t.project ? resolve(t.project) : null) : t.user);
  if (!root) return { code: EXIT.USAGE, json: { error: `${target} has no project skills folder` }, text: `${target} has no project skills folder; drop --project` };
  const dest = join(root, "fiangshi");
  if (existsSync(dest) && !opts.force) return { code: EXIT.ERROR, json: { error: "already installed", path: dest }, text: `already installed at ${dest} (add --force to replace it)` };
  mkdirSync(root, { recursive: true });
  cpSync(join(ROOT, "skills", "fiangshi"), dest, { recursive: true, force: true });
  return { code: 0, json: { installed: dest, target }, text: `installed the Fiangshi skill at ${dest}\n  ${t.note}` };
}

export const AGENT_HELP = `Fiangshi CLI for agents. Asks a running Fiangshi server (FIANGSHI_URL, default http://127.0.0.1:8787).

  fiangshi preview <url>              free: should I pay this x402 endpoint?
  fiangshi payee <0x address>         free: the census record for one wallet
  fiangshi receipt <id>               free: verify a receipt (hash and chain)
  fiangshi quote <url>                the paid full check's price (never pays)
  fiangshi skill install <claude|codex|grok|hermes> [--project] [--force]
  fiangshi mcp                        start the MCP server on stdio

Local pipeline (needs model keys or fixture mode):
  fiangshi check <url> [--json] [--explain] · verify [path] · index · lab

Add --json for machine output. Exit codes: 0 ALLOW · 10 REVIEW / no record · 20 BLOCK · 1 error · 2 usage.
Fiangshi never pays, signs or holds money.`;
