import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { startServer, safeNext, TOUR_COOKIE } from "../src/api/server.js";
import { tmp } from "./helpers.js";

let server: Server;
let base = "";
function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const r = request(base + path, { method: "GET", headers }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (d: Buffer) => parts.push(d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
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

describe("first-visit tour", () => {
  it("a first visit shows the five-step tour, with no script, and sets no cookie by itself", async () => {
    const r = await get("/");
    const html = r.body.toString("utf8");
    expect(html).toContain('<div class="tour" id="tour" role="dialog"');
    expect((html.match(/class="tour-r"/g) ?? []).length).toBe(5);
    expect(html).toContain('id="ts1" checked');
    expect(html).toContain('href="/tour/done?next=/"');
    expect(html).not.toMatch(/<script/i);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
  it("closing it sets one functional cookie and redirects; the next visit has no tour", async () => {
    const r = await get("/tour/done?next=/connect");
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe("/connect");
    const cookie = String(r.headers["set-cookie"]);
    expect(cookie).toContain(TOUR_COOKIE);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const again = (await get("/", { cookie: TOUR_COOKIE })).body.toString("utf8");
    expect(again).not.toContain('class="tour"');
    expect(again).toContain('class="tourbtn" href="/?tour=1"');
  });
  it("the tour button reopens it even with the cookie", async () => {
    expect((await get("/?tour=1", { cookie: TOUR_COOKIE })).body.toString("utf8")).toContain('class="tour"');
  });
  it("closing it from a translated page returns to that language", async () => {
    expect((await get("/ko/tour/done?next=/")).headers.location).toBe("/ko");
    expect((await get("/ja/tour/done?next=/connect")).headers.location).toBe("/ja/connect");
    const zh = (await get("/zh")).body.toString("utf8");
    expect(zh).toContain("欢迎使用 Fiangshi");
    expect(zh).toContain('href="/zh/tour/done?next=/"');
  });
  it("the redirect never leaves the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, "/a b"]) expect(safeNext(bad)).toBe("/");
    expect(safeNext("/guide#limits")).toBe("/guide#limits");
  });
  it("the Legal page discloses the cookie", async () => {
    const legal = (await get("/legal")).body.toString("utf8");
    expect(legal).toContain("fiangshi_tour");
    expect(legal).not.toContain("set no cookies");
  });
});

describe("architecture working models", () => {
  it("four animated figures replace the markers, with no script and no image file", async () => {
    const html = (await get("/architecture")).body.toString("utf8");
    expect((html.match(/<figure class="fxfig">/g) ?? []).length).toBe(4);
    expect(html).not.toContain("animated on the site at /architecture).");
    expect(html).toContain("<animateMotion");
    expect(html).not.toMatch(/<script|<img|xlink:href|href="http/i);
    for (const t of ["Three checks, live", "Who talks to whom, and where the money goes", "The lowest band wins", "The receipt chain catches an edit"]) expect(html).toContain(t);
  });
  it("the figures only show values the lab produced, and say when values are examples", async () => {
    const html = (await get("/architecture")).body.toString("utf8");
    expect(html).toContain("api.cleave.fi/x402/gas");
    expect(html).toContain("score 86.43");
    expect(html).toContain("The numbers shown are examples.");
    expect(html).toContain("The hashes shown are shortened examples.");
  });
});
