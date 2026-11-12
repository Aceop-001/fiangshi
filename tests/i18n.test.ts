import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { request, type Server } from "node:http";
import { ROOT } from "../src/config.js";
import { I18N_ROWS, setLang, t } from "../src/i18n.js";
import { startServer } from "../src/api/server.js";
import { tmp } from "./helpers.js";

const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the dictionary", () => {
  it("every string has Chinese, Japanese and Korean, with the same placeholders", () => {
    for (const [en, zh, ja, ko] of I18N_ROWS) {
      for (const tr of [zh, ja, ko]) {
        expect(tr.trim(), en).not.toBe("");
        expect(ph(tr), en).toEqual(ph(en));
      }
    }
  });
  it("English keys are unique", () => {
    const keys = I18N_ROWS.map((r) => r[0]);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("every T(\"...\") string the pages use is in the dictionary", () => {
    const keys = new Set(I18N_ROWS.map((r) => r[0]));
    const missing: string[] = [];
    for (const f of ["src/site.ts", "src/site-theme.ts"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const m of src.matchAll(/\b(?:T|kv)\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)) {
        const key = m[2]!.replace(/\\(["'\\])/g, "$1");
        if (!keys.has(key)) missing.push(`${f}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it("t() fills placeholders and falls back to English", () => {
    setLang("zh");
    expect(t("{n} payees", { n: 3 })).toBe("3 个收款方");
    expect(t("a string nobody translated")).toBe("a string nobody translated");
    setLang("en");
    expect(t("{n} payees", { n: 3 })).toBe("3 payees");
  });
});

let server: Server;
let base = "";
function get(path: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request(base + path, { method: "GET" }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, body: b }));
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

describe("pages in four languages", () => {
  it("English stays the default, with the switcher and the English wordmark", async () => {
    const r = await get("/");
    expect(r.body).toContain('<html lang="en">');
    expect(r.body).toContain("Who is behind the&nbsp;402?");
    expect(r.body).toContain('<a class="brand" href="/">FIANGSHI</a>');
    expect(r.body).toContain('<nav class="langs"');
    expect(r.body).toContain('href="/zh"');
    expect(r.body).not.toContain('class="clock"');
  });
  it("/zh: Chinese page, links stay in Chinese, API links and the English switch do not", async () => {
    const r = await get("/zh");
    expect(r.status).toBe(200);
    expect(r.headers["content-language"]).toBe("zh-Hans");
    expect(r.body).toContain('<html lang="zh-Hans">');
    expect(r.body).toContain("402 背后是谁？");
    expect(r.body).toContain(">指南</a>");
    expect(r.body).toContain('href="/zh/guide"');
    expect(r.body).toContain('action="/zh/check"');
    expect(r.body).toContain('href="/v1/index.json"');
    expect(r.body).toMatch(/<a href="\/" hreflang="en"/);
    expect(r.body).toContain('<a class="brand" href="/zh">FIANGSHI</a>'); // the wordmark stays English
    expect(r.body).not.toMatch(/<script/i);
  });
  it("/ja and /ko render the home page in Japanese and Korean", async () => {
    expect((await get("/ja")).body).toContain("402 の向こうにいるのは誰？");
    expect((await get("/ko")).body).toContain("402 뒤에는 누가 있을까?");
  });
  it("the check and receipt pages translate too", async () => {
    const r = await get(`/ko/check?url=${encodeURIComponent("https://api.cleave.fi/x402/gas")}`);
    expect(r.body).toContain("탐색 단계에서 규칙 I(null_payee)로 차단.");
    const id = /\/ko\/receipt\/([0-9a-f]{64})/.exec(r.body)?.[1];
    expect((await get(`/ko/receipt/${id}`)).body).toContain("이 영수증은 검증되었습니다.");
  });
  it("documents stay in English with a translated notice", async () => {
    const r = await get("/ja/guide");
    expect(r.body).toContain("この文書は英語のみです。");
    expect(r.body).toContain("Try it: real paid endpoints");
  });
  it("an unknown language prefix is not a page, and JSON is untouched", async () => {
    expect((await get("/fr")).status).toBe(404);
    const j = JSON.parse((await get("/zh/health")).body);
    expect(j.ok).toBe(true);
  });
});
