/**
 * Static edition for GitHub Pages: run the real server in static mode (FIANGSHI_STATIC=1), crawl every page reachable
 * from the home page in all four languages, and write them to a folder. Pages are byte-for-byte what the server renders.
 *
 *   npx tsx scripts/export-static.ts [--out site] [--domain fiangshi.xyz]
 *
 * Each route is written as <route>/index.html, so /guide is served from guide/index.html. Files with an extension
 * (/v1/index.json) keep their name. Also written: 404.html, CNAME (the custom domain) and .nojekyll.
 * Fails (exit 1) if any internal link on any page points at something that is not exported: a static site must
 * never link to a dead page or to a route that needs a live server.
 */
import { mkdirSync, rmSync, writeFileSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ROOT } from "../src/config.js";

const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : d);
const OUT = resolve(ROOT, arg("--out", "site"));
const DOMAIN = arg("--domain", "fiangshi.xyz");

/** Paths a static host can serve: no query string, no server-only route. */
const STATIC_OK = (p: string) => !p.includes("?") && !/^\/(check|tour\/done)\b/.test(p) && !/^\/v1\/(?!index\.json$)/.test(p);

export async function exportStatic(out = OUT, domain = DOMAIN): Promise<{ pages: number; files: number; bytes: number; broken: string[] }> {
  Object.assign(process.env, { FIANGSHI_STATIC: "1", FIANGSHI_DATA_DIR: mkdtempSync(join(tmpdir(), "fiangshi-static-")) });
  const { startServer } = await import("../src/api/server.js");
  const server = await startServer(0, "127.0.0.1");
  const port = (server.address() as { port: number }).port;
  // the receipt pages print copy-paste commands with the server address: point them at a local API, which is what the docs tell people to run
  const get = (path: string) =>
    new Promise<{ status: number; type: string; body: Buffer }>((ok, fail) => {
      const r = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host: "127.0.0.1:8787" } }, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (d: Buffer) => parts.push(d));
        res.on("end", () => ok({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(parts) }));
      });
      r.on("error", fail);
      r.end();
    });

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const seen = new Set<string>();
  const broken: string[] = [];
  const queue = ["/", "/zh", "/ja", "/ko", "/docs", "/v1/index.json"];
  let pages = 0;
  let files = 0;
  const linkedFrom = new Map<string, string>();

  while (queue.length) {
    const batch = queue.splice(0, 16).filter((p) => !seen.has(p));
    batch.forEach((p) => seen.add(p));
    await Promise.all(
      batch.map(async (path) => {
        if (!STATIC_OK(path)) {
          broken.push(`${path} (needs a live server; linked from ${linkedFrom.get(path) ?? "?"})`);
          return;
        }
        const r = await get(path);
        if (r.status !== 200) {
          broken.push(`${path} -> ${r.status} (linked from ${linkedFrom.get(path) ?? "?"})`);
          return;
        }
        const isHtml = r.type.startsWith("text/html");
        const file = isHtml ? join(out, path === "/" ? "" : path, "index.html") : join(out, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, r.body);
        isHtml ? pages++ : files++;
        if (!isHtml) return;
        for (const m of r.body.toString("utf8").matchAll(/\s(?:href|action)="(\/[^"#]*)(?:#[^"]*)?"/g)) {
          const link = m[1]!.replace(/&amp;/g, "&") || "/";
          if (!seen.has(link) && !queue.includes(link)) {
            linkedFrom.set(link, path);
            queue.push(link);
          }
        }
      }),
    );
  }

  const nf = await get("/this-page-does-not-exist");
  writeFileSync(join(out, "404.html"), nf.body);
  writeFileSync(join(out, "CNAME"), `${domain}\n`);
  writeFileSync(join(out, ".nojekyll"), "");
  await new Promise<void>((r) => server.close(() => r()));

  let bytes = 0;
  const walk = (d: string): void => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : (bytes += statSync(join(d, f)).size)));
  walk(out);
  return { pages, files, bytes, broken };
}

if (process.argv[1]?.endsWith("export-static.ts") || process.argv[1]?.endsWith("export-static.js")) {
  const r = await exportStatic();
  console.log(`exported ${r.pages} pages and ${r.files} files (${(r.bytes / 1e6).toFixed(1)} MB) to ${OUT}, domain ${DOMAIN}`);
  if (r.broken.length) {
    console.log(`${r.broken.length} broken internal link(s):\n  ${r.broken.slice(0, 40).join("\n  ")}`);
    process.exit(1);
  }
}
