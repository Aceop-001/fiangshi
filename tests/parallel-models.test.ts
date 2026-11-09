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
  it("Dolphin ALWAYS times out -> an otherwise-clean payee still reaches ALLOW, enrichment incomplete, no vow fires", async () => {
    const s = anon();
    stub("ok", "hang", servAllow(s));
    const r = await evaluateFull(TERMS, s, LABELS, "Acme - the API");
    expect(r.decision.verdict.band).toBe("ALLOW");
    expect(r.decision.verdict.degraded).toBe(false);
    expect(r.decision.vows.filter((v) => v.fired)).toEqual([]);
    expect(r.enrichment).toMatchObject({ status: "incomplete" });
    expect(r.enrichment.reason).toMatch(/timeout/);
    expect(r.decision.verdict.citations).toContainEqual({ signal: "tx_count", quote: s.evidence.tx_count });
  });

  it("inverse: Surf data missing -> V1 silence REVIEW regardless of Dolphin succeeding", async () => {
    const s = { ...anon(), tx_count: null, distinct_payers: null };
    stub("ok", "ok", servAllow(s));
    const r = await evaluateFull(TERMS, s, LABELS, "Acme - the API");
    expect(r.enrichment.status).toBe("complete");
    expect(r.decision.vows.find((v) => v.vow === "silence")?.fired).toBe(true);
    expect(r.decision.verdict.band).toBe("REVIEW");
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
    // parallel ~= 2 attempts x 120 ms = 240 ms; sequential >= SERV 2x120 + Dolphin 2x120 = 480 ms.
    // Threshold sits just under the sequential floor so CPU load (e.g. a server running beside the tests) cannot flake it.
    expect(elapsed).toBeLessThan(4 * 120 - 20);
  });

  it("both succeed, no corroboration context -> Dolphin claim merged as an uncorroborated self-claim (I excluded, neutral)", async () => {
    const s = anon();
    stub("ok", "ok", servAllow(s));
    const r = await evaluateFull(TERMS, s, LABELS, "Acme - the API");
    expect(r.signals.identity.corroborated).toBe(false);
    expect(r.signals.identity.sources).toEqual([]);
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

describe("Dolphin: one retry on timeout only", () => {
  it("a timeout then a valid reply -> claims (one retry used)", async () => {
    const { extractIdentity } = await import("../src/adapters/dolphin.js");
    let n = 0;
    const t = async () => {
      n++;
      if (n === 1) throw new Error("dolphin: timeout after 8000ms");
      return { claims_org: "Acme", claims_product: null, claims_age_claim: null };
    };
    const r = await extractIdentity("retry-bio", t, tmp());
    expect(n).toBe(2);
    expect(r.claims?.claims_org).toBe("Acme");
  });
  it("two timeouts -> no claims (REVIEW downstream), exactly 2 attempts", async () => {
    const { extractIdentity } = await import("../src/adapters/dolphin.js");
    let n = 0;
    const r = await extractIdentity("retry-bio-2", async () => { n++; throw new Error("dolphin: timeout after 8000ms"); }, tmp());
    expect(n).toBe(2);
    expect(r.claims).toBeNull();
  });
  it("a non-timeout failure is NOT retried", async () => {
    const { extractIdentity } = await import("../src/adapters/dolphin.js");
    let n = 0;
    await extractIdentity("retry-bio-3", async () => { n++; throw new Error("dolphin: HTTP 402"); }, tmp());
    expect(n).toBe(1);
  });
  it("default Dolphin timeout is 12 s", async () => {
    const { modelTimeoutMs } = await import("../src/adapters/serv.js");
    delete process.env.FIANGSHI_DOLPHIN_TIMEOUT_MS;
    delete process.env.FIANGSHI_MODEL_TIMEOUT_MS;
    expect(modelTimeoutMs("dolphin")).toBe(12000);
  });
});

describe("identity v3 in the live pipeline", () => {
  it("Dolphin claim 'Acme' + 402 URL acme.example.com -> corroborated by host (I 0.5)", async () => {
    Object.assign(process.env, { FIANGSHI_OFFLINE: "0", MOCK_MODELS: "", SERV_REASONING_API_KEY: "k", SERV_MODEL: "m", DOLPHIN_API_KEY: "k", FIANGSHI_DATA_DIR: tmp() });
    const s = anon();
    stub("ok", "ok", servAllow(s));
    const r = await evaluateFull(TERMS, s, LABELS, "Acme - the API", { url: "https://acme.example.com/v1/q" });
    expect(r.signals.identity).toMatchObject({ claims_org: "Acme", corroborated: true, sources: ["host"] });
  });
});

describe("Dolphin negative cache (timeouts only, TTL)", () => {
  it("a timed-out extraction is not re-attempted within the TTL; a non-timeout failure is", async () => {
    const { extractIdentity } = await import("../src/adapters/dolphin.js");
    const dir = tmp();
    let n = 0;
    const slow = async () => { n++; throw new Error("dolphin: timeout after 12000ms"); };
    await extractIdentity("neg-bio", slow, dir);
    expect(n).toBe(2); // first call: attempt + one retry
    const again = await extractIdentity("neg-bio", slow, dir);
    expect(n).toBe(2); // no new attempt
    expect(again.claims).toBeNull();
    expect(again.error).toMatch(/cached failure/);
    let m = 0;
    const refused = async () => { m++; throw new Error("dolphin: HTTP 402"); };
    await extractIdentity("neg-bio-2", refused, dir);
    await extractIdentity("neg-bio-2", refused, dir);
    expect(m).toBe(2); // not negatively cached
  });
  it("after the TTL the provider is tried again", async () => {
    const { extractIdentity } = await import("../src/adapters/dolphin.js");
    const dir = tmp();
    process.env.FIANGSHI_DOLPHIN_NEGATIVE_TTL_S = "0";
    let n = 0;
    const slow = async () => { n++; throw new Error("dolphin: timeout after 12000ms"); };
    await extractIdentity("neg-bio-3", slow, dir);
    await extractIdentity("neg-bio-3", slow, dir);
    expect(n).toBe(4);
    delete process.env.FIANGSHI_DOLPHIN_NEGATIVE_TTL_S;
  });
});
