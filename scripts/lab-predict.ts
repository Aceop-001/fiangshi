/** Deterministic (no-model) policy band for the synthetic lab sleeper under the current rubric (0 credits). */
import { readFileSync } from "node:fs";
import { loadFixtures402, parse402 } from "../src/adapters/probe.js";
import { coerceSignals } from "../src/check.js";
import { policyBand } from "../src/policy.js";
import type { PayeeSignals } from "../src/core/types.js";

const raw = loadFixtures402().find((r) => r.url === "https://old-quotes.example/v1/quote")!;
const pr = parse402(raw);
if (!pr.ok) throw new Error("sleeper fixture 402 missing");
const fx = (JSON.parse(readFileSync("fixtures/payees.json", "utf8")) as PayeeSignals[]).find((p) => p.payee === pr.terms.payee)!;
const s = coerceSignals(fx, pr.terms.payee);
const r = policyBand(s, pr.terms.price, {}, "v2");
console.log(`sleeper: score ${r.score} band ${r.band} fired ${r.fired.join(",") || "none"} (payers ${s.distinct_payers}, dormancy ${s.dormancy_days}d, price $${pr.terms.price})`);
