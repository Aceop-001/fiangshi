/** SERV + Dolphin run in parallel with per-provider timeouts; one timing out yields REVIEW and keeps the other's evidence. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { evaluateFull } from "../src/check.js";
import { LABELS, clean, tmp } from "./helpers.js";

const TERMS = { url: "https://x.example", price: 0.05, asset: "a", network: "base", payee: "0xpayee", terms_hash: "a".repeat(64) };
const saved = { ...process.env };
const realFetch = globalThis.fetch;

type Behaviour = "ok" | "hang";
function stub(serv: Behaviour, dolphin: Behaviour, servContent: string) {
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
      const isDolphin = String(url).includes("lighthouse.dphn.ai");
      const mode = isDolphin ? dolphin : serv;
      if (mode === "hang") return; // never resolves; only the per-provider timeout ends it
      const content = isDolphin ? JSON.stringify({ claims_org: "Acme", claims_product: "Acme API", claims_age_claim: null }) : servContent;
      resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 9, total_tokens: 18 } }), { status: 200 }));
    })) as typeof fetch;
}

beforeEach(() => {
  Object.assign(process.env, {
    FIANGSHI_OFFLINE: "0",
    MOCK_MODELS: "",
    SERV_REASONING_API_KEY: "test-key-not-real",
    SERV_MODEL: "test-model",
    DOLPHIN_API_KEY: "test-key-not-real",
    FIANGSHI_SERV_TIMEOUT_MS: "120",
    FIANGSHI_DOLPHIN_TIMEOUT_MS: "120",
    FIANGSHI_DATA_DIR: tmp(),
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const anon = () => {
  const s = clean({ identity: { claims_org: null, claims_product: null, corroborated: null } });
  const { identity: _drop, ...evidence } = s.evidence;
  void _drop;
  return { ...s, evidence };
};
const servAllow = (s: ReturnType<typeof clean>) => JSON.stringify({ band: "ALLOW", citations: [{ signal: "tx_count", quote: s.evidence.tx_count }], rationale: "mature" });

describe("parallel SERV + Dolphin", () => {
  it("Dolphin times out -> REVIEW (degraded), SERV's citations preserved", async () => {
    const s = anon();
    stub("ok", "hang", servAllow(s));
    const r = await evaluateFull(TERMS, s, LABELS, "Acme - the API");
    expect(r.decision.verdict.band).toBe("REVIEW");
    expect(r.decision.verdict.degraded).toBe(true);
    expect(r.decision.modelRawBand).toBe("ALLOW");
    expect(r.decision.verdict.citations).toContainEqual({ signal: "tx_count", quote: s.evidence.tx_count });
    expect(r.extraction?.claims).toBeNull();
  });

  it("SERV times out -> REVIEW (degraded), Dolphin's claims preserved as evidence", async () => {
    const s = anon();
    stub("hang", "ok", "");
    const r = await evaluateFull(TERMS, s, LABELS, "Acme - the API");
    expect(r.decision.verdict).toMatchObject({ band: "REVIEW", degraded: true });
    expect(r.extraction?.claims).toEqual({ claims_org: "Acme", claims_product: "Acme API", claims_age_claim: null });
    expect(r.signals.identity.claims_org).toBe("Acme");
    expect(r.signals.evidence.identity).toMatch(/dolphin extract: org=Acme/);
  });

  it("calls overlap: both providers hanging take ~one timeout, not two", async () => {
    stub("hang", "hang", "");
    const t = performance.now();
    const r = await evaluateFull(TERMS, anon(), LABELS, "Acme - the API");
    const elapsed = performance.now() - t;
    expect(r.decision.verdict.band).toBe("REVIEW");
    expect(elapsed).toBeLessThan(2 * 120 + 150); // sequential would need >= 2 x 120ms per attempt (SERV retries once)
  });

  it("both succeed -> Dolphin claims merged but never corroborated; vows still decide", async () => {
    const s = anon();
    stub("ok", "ok", servAllow(s));
    const r = await evaluateFull(TERMS, s, LABELS, "Acme - the API");
    expect(r.signals.identity.corroborated).toBeNull();
    expect(r.decision.verdict.degraded).toBe(false);
    expect(["ALLOW", "REVIEW"]).toContain(r.decision.verdict.band); // uncorroborated claim drops I to 0; age 5000h so no identity vow
  });

  it("no seller text -> Dolphin skipped, verdict depends on SERV alone", async () => {
    const s = anon();
    stub("ok", "hang", servAllow(s));
    const r = await evaluateFull(TERMS, s, LABELS, null);
    expect(r.extraction).toBeNull();
    expect(r.decision.verdict.degraded).toBe(false);
  });
});
