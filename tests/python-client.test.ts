import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Server } from "node:http";
import { ROOT } from "../src/config.js";
import { startServer } from "../src/api/server.js";
import { tmp } from "./helpers.js";

/** Python is optional for contributors: these tests run when a Python 3.9+ interpreter is on the PATH. */
const PY = ["python", "python3"].find((p) => spawnSync(p, ["-c", "import sys; assert sys.version_info >= (3, 9)"]).status === 0);

/** Run Python without blocking this process: the test server lives in the same event loop and must keep answering. */
function run(args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(PY!, args, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...env } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

let server: Server;
let base = "";
beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_DATA_DIR: tmp() });
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 30_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe.skipIf(!PY)("Python client (clients/python)", () => {
  it("its own unit tests pass against a real Fiangshi server, none skipped", async () => {
    const r = await run(["-m", "unittest", "discover", "-s", join(ROOT, "clients", "python")], { FIANGSHI_URL: base });
    expect(r.stderr).toMatch(/\nOK\s*$/);
    expect(r.status).toBe(0);
  }, 70_000);
  it("the command line answers BLOCK with exit code 20, the same as the Node CLI", async () => {
    const r = await run([join(ROOT, "clients", "python", "fiangshi_client.py"), "preview", "https://api.cleave.fi/x402/gas", "--json"], { FIANGSHI_URL: base });
    expect(r.status).toBe(20);
    expect(JSON.parse(r.stdout).band).toBe("BLOCK");
  }, 70_000);
});
