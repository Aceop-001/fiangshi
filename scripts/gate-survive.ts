/**
 * Gate G17: a receipt outlives the server that issued it (0 credits, loopback only).
 *   npx tsx scripts/gate-survive.ts          prints the before/after transcript
 * Starts the server in fixture mode, runs one dry-run paid check, captures receipt + receipt_verify_url, stops the
 * server, deletes the live ledger, starts it again, and checks: the id is forgotten (404 + hint), the payload URL still
 * verifies (valid, band_matches, chain_linkage "unverified"), and one changed byte gives valid: false.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../src/config.js";
import { demoXPayment, type Requirement } from "../src/adapters/x402.js";
import { FIXTURE_TIME } from "../src/reference-time.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; // EIP-55 example vector (dry-run only)
const FROM = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const TARGET = "https://x402.tbs-digital.com/weather/current"; // recorded 402 + recorded model replies (fixture mode)

const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });

async function start(port: number, dataDir: string, useDist: boolean): Promise<ChildProcess> {
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    FIANGSHI_REPLAY: "1",
    FIANGSHI_OFFLINE: "1",
    FIANGSHI_NOW: FIXTURE_TIME,
    MOCK_MODELS: "",
    SERV_REASONING_API_KEY: "",
    DOLPHIN_API_KEY: "",
    SURF_API_KEY: "",
    FIANGSHI_LEDGER_MIRROR: "",
    FIANGSHI_PAYTO: PAYTO,
    FIANGSHI_DATA_DIR: dataDir,
    NODE_NO_WARNINGS: "1",
  };
  const preload = `--import=${pathToFileURL(join(ROOT, "scripts", "no-network.mjs")).href}`;
  // the compiled server starts faster; only accept uses it, because accept has just rebuilt dist (G1)
  const compiled = join(ROOT, "dist", "src", "api", "server.js");
  const args = useDist && existsSync(compiled) ? [preload, compiled] : [preload, "--import", "tsx", "src/api/server.ts"];
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr!.on("data", (d) => (err += d));
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${err.slice(0, 300)}`);
    try {
      if ((await getJson(`http://127.0.0.1:${port}/health`)).status === 200) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error("server did not answer /health within 30 s");
}

const stop = (c: ChildProcess) =>
  new Promise<void>((ok) => {
    if (c.exitCode !== null) return ok();
    c.once("exit", () => ok());
    c.kill();
  });

/** node:http, not fetch: the accept preload refuses fetch even to the local machine. */
const getJson = (url: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; headers: { get: (k: string) => string | undefined }; body: Record<string, any> }>((ok, fail) => {
    const r = request(url, { headers }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        try {
          ok({ status: res.statusCode ?? 0, headers: { get: (k: string) => res.headers[k.toLowerCase()] as string | undefined }, body: JSON.parse(b) });
        } catch (e) {
          fail(e);
        }
      });
    });
    r.on("error", fail);
    r.setTimeout(10_000, () => r.destroy(new Error("timeout")));
    r.end();
  });

export interface SurviveResult {
  ok: boolean;
  problems: string[];
  transcript: string[];
}

export async function gateSurvive(opts: { useDist?: boolean } = {}): Promise<SurviveResult> {
  const useDist = opts.useDist ?? false;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dataDir = join(mkdtempSync(join(tmpdir(), "fiangshi-survive-")), "data");
  const problems: string[] = [];
  const T: string[] = [];
  const need = (cond: unknown, what: string) => {
    if (!cond) problems.push(what);
  };
  let server = await start(port, dataDir, useDist);
  try {
    const health1 = (await getJson(`${base}/health`)).body;
    T.push(`/health ledger_durability: "${health1.ledger_durability}"`);
    const check = `${base}/v1/check?url=${encodeURIComponent(TARGET)}`;
    const r402 = await getJson(check);
    need(r402.status === 402, `unpaid check answered ${r402.status}, not 402`);
    const req = r402.body.accepts?.[0] as Requirement;
    const paid = await getJson(check, { "x-payment": demoXPayment(req, FROM) });
    need(paid.status === 200, `paid check answered ${paid.status}`);
    const { receipt, receipt_id, receipt_verify_url } = paid.body;
    need(receipt?.receipt_hash === receipt_id, "receipt.receipt_hash differs from receipt_id");
    need(paid.headers.get("x-receipt-verify") === receipt_verify_url, "X-RECEIPT-VERIFY header differs from receipt_verify_url");
    need(paid.body.settlement === "dry-run", "settlement is not dry-run");
    T.push(`paid check: ${paid.status} band ${paid.body.band}, receipt_id ${String(receipt_id).slice(0, 16)}…, receipt_verify_url ${String(receipt_verify_url).length} chars`);

    const before = await getJson(`${base}/v1/verify?id=${receipt_id}`);
    need(before.status === 200 && before.body.valid === true && before.body.chain_linkage === "verified", `id lookup before restart: ${before.status} ${JSON.stringify(before.body).slice(0, 120)}`);
    T.push(`before restart, ?id=: ${before.status} valid ${before.body.valid}, chain_linkage "${before.body.chain_linkage}", chain "${before.body.chain}"`);

    await stop(server);
    rmSync(join(dataDir, "ledger.jsonl"), { force: true });
    rmSync(join(dataDir, "ledger-epoch.json"), { force: true });
    server = await start(port, dataDir, useDist);
    T.push("server stopped, live ledger deleted, server started again");

    const after = await getJson(`${base}/v1/verify?id=${receipt_id}`);
    need(after.status === 404 && /resets on redeploy/.test(after.body.error) && /\?receipt=/.test(after.body.hint), `id lookup after restart: ${after.status} ${JSON.stringify(after.body).slice(0, 160)}`);
    T.push(`after restart, ?id=: ${after.status} error "${after.body.error}", hint "${after.body.hint}"`);

    const payload = await getJson(String(receipt_verify_url));
    const pb = payload.body;
    need(payload.status === 200 && pb.valid === true && pb.band_matches === true && pb.chain_linkage === "unverified" && pb.source === "payload", `payload after restart: ${JSON.stringify(pb).slice(0, 200)}`);
    T.push(`after restart, ?receipt=: ${payload.status} valid ${pb.valid}, band_matches ${pb.band_matches}, source "${pb.source}", chain_linkage "${pb.chain_linkage}"`);
    T.push(`  continuity: "${pb.continuity}"`);

    // one byte: the score's last digit
    const json = JSON.stringify(receipt);
    const at = json.indexOf(`"score":`) + `"score":`.length;
    const digitAt = json.slice(at).search(/\d/) + at;
    const flipped = json.slice(0, digitAt) + (json[digitAt] === "9" ? "8" : String(Number(json[digitAt]) + 1)) + json.slice(digitAt + 1);
    const tampered = await getJson(`${base}/v1/verify?receipt=${Buffer.from(flipped).toString("base64url")}`);
    need(tampered.body.valid === false, "a changed byte still verified");
    T.push(`one byte changed (score ${json.slice(at, at + 6)} -> ${flipped.slice(at, at + 6)}): valid ${tampered.body.valid}, errors ${JSON.stringify(tampered.body.errors)}`);
  } finally {
    await stop(server);
  }
  return { ok: problems.length === 0, problems, transcript: T };
}

if (process.argv[1]?.endsWith("gate-survive.ts")) {
  const r = await gateSurvive();
  console.log(r.transcript.join("\n"));
  console.log(r.ok ? "G17 PASS" : `G17 FAIL: ${r.problems.join("; ")}`);
  process.exit(r.ok ? 0 : 1);
}
