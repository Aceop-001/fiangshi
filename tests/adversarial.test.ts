/** Hand-written attacks on our own logic. The expected result is in each test name. */
import { describe, it, expect } from "vitest";
import { parse402, loadFixtures402 } from "../src/adapters/probe.js";
import { decide } from "../src/core/decide.js";
import { sanitize } from "../src/core/score.js";
import { isStale } from "../src/ledger/drift.js";
import { buildSnapshot, normalizePayees } from "../src/snapshot.js";
import { hashOf } from "../src/core/canonical.js";
import { advice, allowRaw, clean, LABELS } from "./helpers.js";

const run = (over: Parameters<typeof clean>[0], price: number | null = 0.05, raw?: (s: ReturnType<typeof clean>) => string) => {
  const s = sanitize(clean(over));
  return decide(s, price, LABELS, advice((raw ?? allowRaw)(s), s)).verdict;
};

describe("adversarial", () => {
  it("future timestamp (wallet created in the future => negative age) -> REVIEW via silence, never BLOCK", () => {
    expect(run({ wallet_age_hours: -5 })).toMatchObject({ band: "REVIEW", vow_fired: "silence" });
  });

  it("future checked_at on a cached verdict -> stale, never trusted as fresh", () => {
    expect(isStale("2099-01-01T00:00:00Z", new Date("2026-11-08T00:00:00Z"), 72)).toBe(true);
  });

  it("payee that is the funder itself -> funder treated as missing -> REVIEW", () => {
    const v = run({ payee: "0xself", first_funder: "0xSELF" });
    expect(v).toMatchObject({ band: "REVIEW", vow_fired: "silence" });
  });

  it("quote with trailing whitespace -> not a substring -> degraded REVIEW", () => {
    const v = run({}, 0.05, (s) => JSON.stringify({ band: "ALLOW", citations: [{ signal: "tx_count", quote: s.evidence.tx_count + " " }] }));
    expect(v).toMatchObject({ band: "REVIEW", degraded: true });
  });

  it("empty-string quote -> rejected (empty is a substring of everything) -> degraded REVIEW", () => {
    const v = run({}, 0.05, () => JSON.stringify({ band: "ALLOW", citations: [{ signal: "tx_count", quote: "" }] }));
    expect(v).toMatchObject({ band: "REVIEW", degraded: true });
  });

  it("quote borrowed from another signal's evidence -> rejected -> degraded REVIEW", () => {
    const v = run({}, 0.05, (s) => JSON.stringify({ band: "ALLOW", citations: [{ signal: "tx_count", quote: s.evidence.distinct_payers }] }));
    expect(v).toMatchObject({ band: "REVIEW", degraded: true });
  });

  it("empty evidence map -> model cannot cite anything -> degraded, never ALLOW", () => {
    const v = run({ evidence: {} });
    expect(v.degraded).toBe(true);
    expect(v.band).not.toBe("ALLOW");
  });

  it("duplicate payees in the catalog -> deduped once, snapshot payload hash unchanged", async () => {
    const one = normalizePayees([clean({ payee: "0xA" }), clean({ payee: "0xb" })]);
    const dup = normalizePayees([clean({ payee: "0xb" }), clean({ payee: "0xA" }), clean({ payee: "0xa" })]);
    expect(hashOf(dup.payees)).toBe(hashOf(one.payees));
    const { snapshot } = await buildSnapshot();
    expect(new Set(snapshot.payload.payees.map((p) => p.payee)).size).toBe(snapshot.payload.payees.length);
  });

  it('price "0" -> parsed as $0.00; history vow does not fire; still scored', () => {
    const raw = structuredClone(loadFixtures402()[7]!);
    (raw.body as { accepts: { maxAmountRequired: string }[] }).accepts[0]!.maxAmountRequired = "0";
    const r = parse402(raw);
    expect(r.ok && r.terms.price).toBe(0);
    expect(run({ distinct_payers: 0 }, 0).vow_fired).toBeUndefined();
  });

  it("negative age -> sanitized to missing -> REVIEW, not BLOCK by the age vow", () => {
    expect(run({ wallet_age_hours: -1000 }).band).toBe("REVIEW");
  });

  it("token_concentration 1.5 (out of range) -> missing -> REVIEW", () => {
    expect(run({ token_concentration: 1.5 }).band).toBe("REVIEW");
  });

  it("NaN tx_count -> missing -> REVIEW", () => {
    expect(run({ tx_count: Number.NaN }).band).toBe("REVIEW");
  });
});
