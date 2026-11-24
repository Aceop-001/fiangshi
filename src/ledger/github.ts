/**
 * Durable receipts on a GitHub repository (2026-11-24). Render's free tier wipes the disk on every redeploy, so the live
 * ledger alone forgets receipts. With FIANGSHI_RECEIPTS_REPO ("owner/repo") and FIANGSHI_RECEIPTS_TOKEN (a token that
 * can write that repo's contents) set, every sealed receipt is also committed to the repo:
 *
 *   receipts/<id[0..2]>/<id>.json   the receipt, byte-identical to the ledger line (its id is its sha256, so it is
 *                                   written once and never changed)
 *   receipts/HEAD.json              { receipt_hash, chain_id, started_at, count }: the newest receipt, so a fresh
 *                                   process continues the same chain instead of starting a new epoch
 *
 * Writes go one at a time (GitHub's docs: parallel writes to contents conflict). Reads use the contents API with the raw
 * media type. Anyone can re-check a receipt from the repo's history without trusting this server.
 * API: PUT/GET /repos/{owner}/{repo}/contents/{path} (docs.github.com/en/rest/repos/contents, read 2026-11-24).
 */
import { env } from "../config.js";
import type { Receipt } from "../core/types.js";

const API = "https://api.github.com";
export const receiptsRepo = (): string | null => {
  const r = env("FIANGSHI_RECEIPTS_REPO");
  return r && /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null;
};
const token = () => env("FIANGSHI_RECEIPTS_TOKEN") || null;
const branch = () => env("FIANGSHI_RECEIPTS_BRANCH") || "main";
export const githubStoreOn = () => receiptsRepo() !== null && token() !== null;

export const receiptPath = (id: string) => `receipts/${id.slice(0, 2)}/${id}.json`;
const HEAD_PATH = "receipts/HEAD.json";

export interface Head {
  receipt_hash: string;
  chain_id: string | null;
  started_at: string;
  count: number;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** tests only: observe the HTTP boundary */
export const setGithubFetch = (f: Fetch) => (fetchImpl = f);

const headers = (accept = "application/vnd.github+json") => ({
  Authorization: `Bearer ${token()}`,
  Accept: accept,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "fiangshi",
});
const url = (path: string) => `${API}/repos/${receiptsRepo()}/contents/${path}`;

/** GET a file's raw text, or null when it does not exist. */
async function getRaw(path: string): Promise<string | null> {
  const r = await fetchImpl(`${url(path)}?ref=${encodeURIComponent(branch())}`, { headers: headers("application/vnd.github.raw+json"), signal: AbortSignal.timeout(10_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`github GET ${path}: ${r.status}`);
  return r.text();
}

/** The blob sha of a file (needed to update it), or null when it does not exist. */
async function shaOf(path: string): Promise<string | null> {
  const r = await fetchImpl(`${url(path)}?ref=${encodeURIComponent(branch())}`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`github GET ${path}: ${r.status}`);
  return ((await r.json()) as { sha?: string }).sha ?? null;
}

async function put(path: string, text: string, message: string, sha: string | null): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetchImpl(url(path), {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: Buffer.from(text, "utf8").toString("base64"), branch: branch(), ...(sha ? { sha } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 200 || r.status === 201) return;
    if (r.status === 409) {
      await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
      continue;
    }
    throw new Error(`github PUT ${path}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  }
  throw new Error(`github PUT ${path}: conflict after 3 attempts`);
}

/* ------------------------------------------------------------------ writes: one at a time ---------------------------- */
let queue: Promise<void> = Promise.resolve();
export const lastError: { message: string | null; at: string | null } = { message: null, at: null };
let written = 0;

/** Queue a sealed receipt (exact ledger line) and the new HEAD. Never throws into the request path. */
export function storeReceipt(r: Receipt, line: string, head: Head): Promise<void> {
  if (!githubStoreOn()) return Promise.resolve();
  queue = queue.then(async () => {
    try {
      const p = receiptPath(r.receipt_hash);
      // immutable: a receipt id is its own hash, so an existing file already holds these exact bytes
      if ((await shaOf(p)) === null) await put(p, line + "\n", `receipt ${r.receipt_hash.slice(0, 12)}`, null);
      await put(HEAD_PATH, JSON.stringify(head, null, 1) + "\n", `head ${r.receipt_hash.slice(0, 12)} (#${head.count})`, await shaOf(HEAD_PATH));
      written++;
    } catch (e) {
      lastError.message = (e as Error).message;
      lastError.at = new Date().toISOString();
      console.error(`receipt store: ${lastError.message}`);
    }
  });
  return queue;
}
/** tests and shutdown: wait for queued writes */
export const flushStore = () => queue;

/** A receipt by id from the repo, parsed, or null. */
export async function fetchStoredReceipt(id: string): Promise<{ receipt: Receipt; text: string } | null> {
  if (!githubStoreOn() || !/^[0-9a-f]{64}$/.test(id)) return null;
  const text = await getRaw(receiptPath(id));
  return text === null ? null : { receipt: JSON.parse(text) as Receipt, text: text.trimEnd() };
}

export async function fetchHead(): Promise<Head | null> {
  if (!githubStoreOn()) return null;
  const text = await getRaw(HEAD_PATH);
  return text === null ? null : (JSON.parse(text) as Head);
}

export function storeStatus(): string | null {
  const repo = receiptsRepo();
  if (!githubStoreOn()) return null;
  return `durable: receipts committed to github.com/${repo} (${written} written by this process${lastError.message ? `; last error ${lastError.at}: ${lastError.message}` : ""})`;
}
