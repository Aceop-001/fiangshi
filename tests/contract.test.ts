import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFixtures402, parse402 } from "../src/adapters/probe.js";
import { check, coerceSignals, evaluate } from "../src/check.js";
import { buildSnapshot } from "../src/snapshot.js";
import { ModelOutput, PayeeSignals, RawResponse, Receipt, Snapshot, Terms, Verdict } from "../src/core/types.js";
import { clean, LABELS, tmp } from "./helpers.js";
import type { z } from "zod";

const roundTrip = <T extends z.ZodTypeAny>(schema: T, value: unknown) => {
  const parsed = schema.parse(value);
  expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
};

beforeAll(() => {
  process.env.MOCK_MODELS = "good";
});

describe("contract: every schema round-trips a fixture", () => {
  it("RawResponse + Terms (fixtures/402)", () => {
    for (const raw of loadFixtures402()) {
      roundTrip(RawResponse, raw);
      const r = parse402(raw);
      if (r.ok) roundTrip(Terms, r.terms);
    }
  });
  it("PayeeSignals (fixtures/payees.json)", () => {
    for (const p of JSON.parse(readFileSync(join("fixtures", "payees.json"), "utf8")) as unknown[]) roundTrip(PayeeSignals, p);
  });
  it("ModelOutput (fixtures/model/*.json)", () => {
    for (const n of ["good", "hallucinated", "badquote"]) roundTrip(ModelOutput, JSON.parse((JSON.parse(readFileSync(join("fixtures", "model", `${n}.json`), "utf8")) as { raw: string }).raw));
  });
  it("Snapshot, Verdict, Receipt (built offline)", async () => {
    const { snapshot } = await buildSnapshot();
    roundTrip(Snapshot, snapshot);
    const r = await check("https://api.weatherly.example/v1/forecast", { snapshot, ledger: join(tmp(), "l.jsonl") });
    roundTrip(Verdict, r.decision.verdict);
    roundTrip(Receipt, r.receipt);
  });
});

describe("contract: a missing required field -> REVIEW, never a crash, never ALLOW", () => {
  const keys = Object.keys(PayeeSignals.shape) as (keyof PayeeSignals)[];
  for (const k of keys.filter((k) => k !== "payee"))
    it(`row without "${k}" -> REVIEW`, async () => {
      const row: Record<string, unknown> = { ...clean() };
      delete row[k];
      const s = coerceSignals(row, "0xpayee");
      const d = await evaluate({ url: "u", price: 0.05, asset: "a", network: "base", payee: "0xpayee", terms_hash: "a".repeat(64) }, s, LABELS);
      expect(d.verdict.band).toBe("REVIEW");
    });
});
