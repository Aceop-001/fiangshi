#!/usr/bin/env node
/** fiangshi check <url> [--json] [--explain] · verify [path] · index · lab · certify */
import { loadDotEnv } from "../config.js";
import { check } from "../check.js";
import { explain } from "./explain.js";
import { verifyPath } from "../../scripts/verify-receipt.js";
import { buildIndex } from "../../scripts/build-index.js";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const args = rest.filter((a) => !a.startsWith("--"));

async function main(): Promise<number> {
  switch (cmd) {
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
    case "lab":
    case "certify":
      console.error(`${cmd}: not built yet (${cmd === "lab" ? "phase 9" : "phase 8, needs Kite wiring"})`);
      return 2;
    default:
      return usage();
  }
}

function usage(): number {
  console.error("usage: fiangshi check <url> [--json] [--explain] | verify [ledger.jsonl|receipt.json] | index | lab | certify");
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  },
);
