#!/usr/bin/env node
/** fiangshi preview|payee|receipt|quote|skill|mcp (agent commands, src/cli/agent.ts) · check <url> [--json] [--explain] · verify [path] · index · lab · certify */
import { loadDotEnv } from "../config.js";
import { check } from "../check.js";
import { explain } from "./explain.js";
import { verifyPath } from "../../scripts/verify-receipt.js";
import { buildIndex } from "../../scripts/build-index.js";
import { AGENT_HELP, installSkill, payee, preview, quote, receipt } from "./agent.js";
import { serveStdio } from "../mcp/server.js";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const args = rest.filter((a) => !a.startsWith("--"));

async function main(): Promise<number> {
  const emit = (o: { code: number; json: unknown; text: string }) => {
    if (flags.has("--json")) console.log(JSON.stringify(o.json, null, 2));
    else (o.code === 2 ? console.error : console.log)(o.text);
    return o.code;
  };
  switch (cmd) {
    case "preview":
      return emit(await preview(args[0]));
    case "payee":
      return emit(await payee(args[0]));
    case "receipt":
      return emit(await receipt(args[0]));
    case "quote":
      return emit(await quote(args[0]));
    case "skill":
      if (args[0] !== "install") return emit({ code: 2, json: { error: "usage" }, text: "usage: fiangshi skill install <claude|codex|grok|hermes> [--project] [--force]" });
      return emit(installSkill(args[1], { project: flags.has("--project"), force: flags.has("--force") }));
    case "mcp":
      serveStdio();
      return await new Promise<number>(() => {});
    case "help":
    case "--help":
    case undefined:
      console.log(AGENT_HELP);
      return 0;
    case "check": {
      const url = args[0];
      if (!url) return usage();
      const r = await check(url);
      if (flags.has("--json")) console.log(JSON.stringify({ verdict: r.decision.verdict, receipt: r.receipt, ms: Math.round(r.ms) }, null, 2));
      else if (flags.has("--explain")) console.log(explain(r));
      else
        console.log(
          `${r.decision.verdict.band}  score=${r.decision.verdict.score}  vow=${r.decision.verdict.vow_fired ?? "none"}  degraded=${r.decision.verdict.degraded}  receipt=${r.receipt.receipt_hash.slice(0, 16)}…  (${Math.round(r.ms)}ms)`,
        );
      return 0;
    }
    case "verify": {
      const r = verifyPath(args[0]);
      console.log(r.ok ? `verify OK (${r.count} receipts)` : `verify FAILED\n${r.errors.join("\n")}`);
      return r.ok ? 0 : 1;
    }
    case "index": {
      const r = await buildIndex();
      console.log(`index: ${r.rows} payees -> ${r.path}`);
      return 0;
    }
    case "lab": {
      // 0 credits: renders artifacts/lab.md from the latest fixtures/lab/results*.json (run scripts/build-lab.ts to re-run the lab)
      await import("../../scripts/matrix.js");
      return 0;
    }
    case "certify":
      console.error(`${cmd}: not built yet (phase 8, needs Kite wiring)`);
      return 2;
    default:
      return usage();
  }
}

function usage(): number {
  console.error(AGENT_HELP);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  },
);
