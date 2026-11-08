/** Re-parse saved raw 402s and print the parser verdict + zod issues (debug aid; 0 network). Usage: npx tsx scripts/parse-check.ts <dir> */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Body402, parse402 } from "../src/adapters/probe.js";

const dir = process.argv[2]!;
for (const f of readdirSync(dir)) {
  const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const r = parse402(raw);
  if (r.ok) {
    console.log(f.padEnd(34), `ok payee=${r.terms.payee.slice(0, 10)} price=${r.terms.price}`);
    continue;
  }
  const z = Body402.safeParse(typeof raw.body === "string" ? undefined : raw.body);
  const issues = z.success ? "body ok?" : z.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");
  console.log(f.padEnd(34), `FAIL ${r.error} :: ${issues}`);
}
