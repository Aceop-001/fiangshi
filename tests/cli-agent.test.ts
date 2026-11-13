import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import { ROOT } from "../src/config.js";
import { startServer } from "../src/api/server.js";
import { EXIT, exitFor, installSkill, payee, preview, quote, receipt } from "../src/cli/agent.js";
import { tmp } from "./helpers.js";

const NULL_PAYEE_URL = "https://api.cleave.fi/x402/gas";
let server: Server;
beforeAll(async () => {
  Object.assign(process.env, { FIANGSHI_DATA_DIR: tmp() });
  server = await startServer(0, "127.0.0.1");
  const a = server.address();
  process.env.FIANGSHI_URL = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 30_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("agent CLI", () => {
  it("exit codes fail closed: only ALLOW is 0, only BLOCK is 20, everything else is REVIEW", () => {
    expect(exitFor("ALLOW")).toBe(0);
    expect(exitFor("BLOCK")).toBe(20);
    for (const v of ["REVIEW", "no_record", "no_verdict", undefined, "allow", ""]) expect(exitFor(v)).toBe(EXIT.REVIEW);
  });
  it("preview: a null payee is BLOCK with exit 20 and a receipt that verifies", async () => {
    const r = await preview(NULL_PAYEE_URL);
    expect(r.code).toBe(20);
    expect(r.text).toMatch(/^BLOCK/);
    expect(r.text).toContain("do not pay");
    const id = (r.json as { receipt_id: string }).receipt_id;
    const v = await receipt(id);
    expect(v.code).toBe(0);
    expect(v.text).toMatch(/^VALID/);
  });
  it("payee: a census wallet returns its band; an unknown one is REVIEW, never ALLOW", async () => {
    const unknown = await payee("0x0000000000000000000000000000000000000001");
    expect(unknown.code).toBe(EXIT.REVIEW);
    expect(unknown.text).toContain("NO RECORD");
  });
  it("quote never pays: a null payee is answered free, otherwise it reports the 402", async () => {
    const r = await quote(NULL_PAYEE_URL);
    expect(r.code).toBe(20);
  });
  it("bad arguments are usage errors (exit 2), and an unreachable server is exit 1", async () => {
    expect((await preview("not a url")).code).toBe(2);
    expect((await payee("bob")).code).toBe(2);
    expect((await receipt("abc")).code).toBe(2);
    const keep = process.env.FIANGSHI_URL;
    process.env.FIANGSHI_URL = "http://127.0.0.1:1";
    const r = await preview(NULL_PAYEE_URL);
    process.env.FIANGSHI_URL = keep;
    expect(r.code).toBe(1);
    expect(r.text).toContain("could not reach Fiangshi");
  });
});

describe("the Fiangshi skill", () => {
  const md = readFileSync(join(ROOT, "skills", "fiangshi", "SKILL.md"), "utf8");
  it("has Agent Skills frontmatter: a lowercase name and a description under 1,024 characters", () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(md.replace(/\r\n/g, "\n"))?.[1] ?? "";
    expect(/^name: (.+)$/m.exec(fm)?.[1]).toBe("fiangshi");
    const desc = /^description: (.+)$/m.exec(fm)?.[1] ?? "";
    expect(desc.length).toBeGreaterThan(50);
    expect(desc.length).toBeLessThan(1024);
  });
  it("tells the agent the fail-closed rule and the real exit codes", () => {
    expect(md).toContain("Never treat them as ALLOW");
    expect(md).toContain("`0` ALLOW, `10` REVIEW or no record, `20` BLOCK");
    for (const tool of ["fiangshi_preview", "fiangshi_payee", "fiangshi_verify_receipt", "fiangshi_check"]) expect(md).toContain(tool);
  });
  it("skill install copies the folder, and refuses to overwrite without --force", () => {
    const dir = tmp();
    const r = installSkill("claude", { dir });
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "fiangshi", "SKILL.md"))).toBe(true);
    expect(installSkill("claude", { dir }).code).toBe(1);
    expect(installSkill("claude", { dir, force: true }).code).toBe(0);
    expect(installSkill("nope", { dir }).code).toBe(2);
  });
});
