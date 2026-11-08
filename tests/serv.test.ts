import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adjudicate } from "../src/adapters/serv.js";
import { decide, validateModelOutput } from "../src/core/decide.js";
import { coerceSignals } from "../src/check.js";
import { advice, clean, LABELS, unreachable } from "./helpers.js";

const payees = JSON.parse(readFileSync(join("fixtures", "payees.json"), "utf8")) as unknown[];
const modelFx = (n: string) => JSON.parse(readFileSync(join("fixtures", "model", `${n}.json`), "utf8")) as { payee: string; raw: string };
const ctrl01 = () => {
  const fx = modelFx("good");
  return coerceSignals(payees.find((p) => (p as { payee: string }).payee === fx.payee), fx.payee);
};

describe("SERV output validation (fixtures/model)", () => {
  it("good output validates", () => {
    expect(validateModelOutput(modelFx("good").raw, ctrl01()).ok).toBe(true);
  });
  it("hallucinated signal name is rejected", () => {
    const v = validateModelOutput(modelFx("hallucinated").raw, ctrl01());
    expect(v.ok).toBe(false);
    expect(!v.ok && v.errors.join()).toMatch(/not in input/);
  });
  it("quote that is not a substring is rejected", () => {
    const v = validateModelOutput(modelFx("badquote").raw, ctrl01());
    expect(v.ok).toBe(false);
    expect(!v.ok && v.errors.join()).toMatch(/not a substring/);
  });
  it("non-JSON is rejected", () => expect(validateModelOutput("ALLOW!", ctrl01()).ok).toBe(false));
  it("missing band is rejected", () => expect(validateModelOutput(JSON.stringify({ citations: [] }), ctrl01()).ok).toBe(false));
  it("rejected output -> degraded verdict capped at REVIEW", () => {
    const s = ctrl01();
    const d = decide(s, 0.05, LABELS, advice(modelFx("hallucinated").raw, s));
    expect(d.verdict.degraded).toBe(true);
    expect(d.verdict.band).toBe("REVIEW");
  });
  it("unreachable model -> degraded REVIEW", () => {
    const d = decide(clean(), 0.05, LABELS, unreachable);
    expect(d.verdict).toMatchObject({ band: "REVIEW", degraded: true });
  });
});

describe("serv adapter mocks", () => {
  afterEach(() => {
    process.env.MOCK_MODELS = "";
  });
  it("broken mock retries once stricter, then degrades (2 attempts)", async () => {
    process.env.MOCK_MODELS = "broken";
    const a = await adjudicate({ terms: null, signals: clean(), score: 90, silence: false });
    expect(a.attempts).toBe(2);
    expect(a.validation?.ok).toBe(false);
  });
  it("good mock validates on first attempt", async () => {
    process.env.MOCK_MODELS = "good";
    const a = await adjudicate({ terms: null, signals: clean(), score: 90, silence: false });
    expect(a.attempts).toBe(1);
    expect(a.validation?.ok).toBe(true);
  });
});
