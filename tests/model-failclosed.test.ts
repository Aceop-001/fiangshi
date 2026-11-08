/**
 * The live SERV and Dolphin paths must fail closed: malformed output, a timeout, an empty body, an HTTP error,
 * or truncation never produce ALLOW, never crash, and never cache. Network is stubbed per test (no real calls).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { evaluate } from "../src/check.js";
import { extractIdentity, liveTransport } from "../src/adapters/dolphin.js";
import { LABELS, clean, tmp } from "./helpers.js";

const TERMS = { url: "https://x.example", price: 0.05, asset: "a", network: "base", payee: "0xpayee", terms_hash: "a".repeat(64) };
const saved = { ...process.env };
const realFetch = globalThis.fetch;

type Reply = () => Promise<Response>;
const stub = (reply: Reply) => {
  globalThis.fetch = ((_: unknown, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
      reply().then(resolve, reject);
    })) as typeof fetch;
};
const json = (o: unknown, status = 200) => async () => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const chat = (content: string | null, finish = "stop") => json({ choices: [{ message: { role: "assistant", content }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
const never: Reply = () => new Promise(() => {});

beforeEach(() => {
  Object.assign(process.env, {
    FIANGSHI_OFFLINE: "0",
    MOCK_MODELS: "",
    SERV_REASONING_API_KEY: "test-key-not-real",
    SERV_MODEL: "test-model",
    DOLPHIN_API_KEY: "test-key-not-real",
    FIANGSHI_MODEL_TIMEOUT_MS: "50",
    FIANGSHI_DATA_DIR: tmp(),
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const servCases: [string, Reply][] = [
  ["malformed body (not JSON)", async () => new Response("<html>oops</html>", { status: 200 })],
  ["malformed content (prose, not the schema)", chat("Sure! I'd say ALLOW.")],
  ["schema-valid JSON but hallucinated citation", chat(JSON.stringify({ band: "ALLOW", citations: [{ signal: "kyc", quote: "verified" }], rationale: "x" }))],
  ["empty body", async () => new Response("", { status: 200 })],
  ["empty message content", chat("")],
  ["truncated output (finish_reason=length)", chat('{"band":"ALLOW","citations":[', "length")],
  ["HTTP 500", json({ error: "boom" }, 500)],
  ["timeout", never],
];

describe("SERV live path fails closed", () => {
  for (const [name, reply] of servCases)
    it(`${name} -> REVIEW, degraded, never ALLOW`, async () => {
      stub(reply);
      const d = await evaluate(TERMS, clean(), LABELS);
      expect(d.verdict.band).toBe("REVIEW");
      expect(d.verdict.degraded).toBe(true);
    });

  it("control: a valid, cited response is accepted (not degraded)", async () => {
    const s = clean();
    stub(chat(JSON.stringify({ band: "ALLOW", citations: [{ signal: "tx_count", quote: s.evidence.tx_count }], rationale: "mature, many payers" })));
    const d = await evaluate(TERMS, s, LABELS);
    expect(d.verdict.degraded).toBe(false);
    expect(d.verdict.band).toBe("ALLOW");
  });

  it("vow still wins over a valid live ALLOW (age 5h -> BLOCK)", async () => {
    const s = clean({ wallet_age_hours: 5 });
    stub(chat(JSON.stringify({ band: "ALLOW", citations: [{ signal: "tx_count", quote: s.evidence.tx_count }], rationale: "looks fine" })));
    const d = await evaluate(TERMS, s, LABELS);
    expect(d.modelRawBand).toBe("ALLOW");
    expect(d.verdict).toMatchObject({ band: "BLOCK", vow_fired: "age", degraded: false });
  });
});

const dolphinCases: [string, Reply][] = [
  ["malformed content", chat("The org is probably Acme.")],
  ["extra keys (not the IdentityClaims schema)", chat(JSON.stringify({ claims_org: "Acme", claims_product: null, claims_age_claim: null, trust: "high" }))],
  ["empty body", async () => new Response("", { status: 200 })],
  ["HTTP 402 insufficient credits", json({ error: "credits" }, 402)],
  ["timeout", never],
];

describe("Dolphin live path fails closed", () => {
  for (const [name, reply] of dolphinCases)
    it(`${name} -> claims null, no cache, no throw`, async () => {
      stub(reply);
      const dir = tmp();
      const r = await extractIdentity(`bio ${name}`, liveTransport, dir);
      expect(r.claims).toBeNull();
      expect(r.cached).toBe(false);
      const again = await extractIdentity(`bio ${name}`, liveTransport, dir);
      expect(again.cached).toBe(false); // failures are never cached
    });

  it("control: fenced JSON with the exact schema is accepted and cached", async () => {
    stub(chat('```json\n{"claims_org":"Acme","claims_product":"Acme API","claims_age_claim":null}\n```'));
    const dir = tmp();
    expect((await extractIdentity("Acme - the API", liveTransport, dir)).claims).toEqual({ claims_org: "Acme", claims_product: "Acme API", claims_age_claim: null });
    expect((await extractIdentity("Acme - the API", liveTransport, dir)).cached).toBe(true);
  });
});
