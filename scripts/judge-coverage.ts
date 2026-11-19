/**
 * Judge coverage (post-deadline): what /v1/preview answers for each hackathon endpoint, regenerated from this
 * branch's own server in live mode. Free routes only: one unpaid GET per endpoint (plus redirects and a TLS
 * handshake for signals), no payment, no model call, no Surf call.
 *
 *   npx tsx scripts/judge-coverage.ts [--list fixtures/judge/endpoints-38.txt] [--out docs/judge-coverage.md]
 *
 * The goal it measures: every endpoint gets a structured record (a class), and none abstains as a bare probe
 * failure. A record can be VERDICT, NO_RECORD, PAYMENT_TERMS_UNPARSEABLE or UNVERIFIED_ENDPOINT.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1]! : d;
};
// live: the free routes probe real endpoints; nothing recorded, nothing mocked
Object.assign(process.env, { FIANGSHI_ALLOW_FIXTURE: "0", FIANGSHI_REPLAY: "0", FIANGSHI_OFFLINE: "0", SNAPSHOT_SOURCE: "live", MOCK_MODELS: "" });
const { ROOT } = await import("../src/config.js");
const { startServer } = await import("../src/api/server.js");

const list = readFileSync(join(ROOT, arg("--list", "fixtures/judge/endpoints-38.txt")), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const server = await startServer(0, "127.0.0.1");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Row = { url: string; class: string; verdict: string; reason: string; signals: { name: string; value: unknown; detail?: string }[]; ms: number };
const rows: Row[] = new Array(list.length);
let next = 0;
async function worker() {
  for (;;) {
    const i = next++;
    if (i >= list.length) return;
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}/v1/preview?url=${encodeURIComponent(list[i]!)}`, { signal: AbortSignal.timeout(30_000) });
      const j = (await r.json()) as Record<string, unknown>;
      rows[i] = { url: list[i]!, class: String(j.class ?? "none"), verdict: String(j.verdict), reason: String(j.reason ?? ""), signals: (j.signals as Row["signals"]) ?? [], ms: Date.now() - t0 };
    } catch (e) {
      rows[i] = { url: list[i]!, class: "ERROR", verdict: "error", reason: (e as Error).message, signals: [], ms: Date.now() - t0 };
    }
    process.stdout.write(`${rows[i]!.class.padEnd(26)} ${list[i]}\n`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker)); // concurrency capped
server.close();

const sig = (r: Row, n: string) => {
  const s = r.signals.find((x) => x.name === n);
  return s === undefined ? "" : String(s.detail && n === "status_class" ? s.detail : s.value);
};
const count = (k: string) => rows.filter((r) => r.class === k).length;
const bare = rows.filter((r) => r.class === "none" || r.class === "ERROR").length;
const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const md = [
  "# Judge coverage",
  "",
  `Post-deadline work (branch \`post-deadline/coverage\`). The judged entry is commit \`59b4712\` as of 15 Nov 23:59 UTC.`,
  "",
  `Measured ${at} by \`npx tsx scripts/judge-coverage.ts\`: this branch's server in live mode, asked \`GET /v1/preview\` for each of the ${rows.length} hackathon endpoints in \`fixtures/judge/endpoints-38.txt\`. Free route only: no payment, no model call, no Surf call. Results depend on the endpoints at that moment.`,
  "",
  "## Summary",
  "",
  "| class | endpoints |",
  "|---|---|",
  ...["VERDICT", "NO_RECORD", "PAYMENT_TERMS_UNPARSEABLE", "UNVERIFIED_ENDPOINT"].map((k) => `| \`${k}\` | ${count(k)} |`),
  `| bare probe failure (no class) | ${bare} |`,
  "",
  `Target: every endpoint gets a structured record. ${bare === 0 ? `Met: ${rows.length} of ${rows.length}.` : `Not met: ${bare} without a class.`}`,
  "",
  "## Not done on this branch",
  "",
  "- **Census self-coverage (workstream D):** skipped. The service's own payTo is not in the census; adding it needs fresh Surf credits.",
  "- **OpenServ marketplace (workstream C):** skipped. None of the 151 listings at `https://api.openserv.ai/x402-services` names a payee wallet (see `docs/judge-gap-baseline.md`).",
  "",
  "## Every endpoint",
  "",
  "| endpoint | class | status chain | final host | terms | TLS | reason |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.url} | \`${r.class}\` | ${sig(r, "status_class")} | ${sig(r, "final_host")} | ${sig(r, "machine_terms")} | ${sig(r, "tls_valid")} | ${esc(r.reason).slice(0, 220)} |`),
  "",
];
writeFileSync(join(ROOT, arg("--out", "docs/judge-coverage.md")), md.join("\n"));
console.log(`\n${rows.length} endpoints: ${["VERDICT", "NO_RECORD", "PAYMENT_TERMS_UNPARSEABLE", "UNVERIFIED_ENDPOINT"].map((k) => `${k} ${count(k)}`).join(", ")}, bare ${bare}`);
