/**
 * E (post-deadline): live by default. With no FIANGSHI_ALLOW_FIXTURE, every fixture or mock setting is ignored,
 * provenance is live, and a check really calls SERV (stubbed at the HTTP boundary: the call is observed, not made).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { evaluate } from "../src/check.js";
import { fixtureAllowed, fixtureIgnored, isOffline, mockModels, providerMode, replayMode, snapshotSource } from "../src/config.js";
import { LABELS, clean, tmp } from "./helpers.js";

const TERMS = { url: "https://x.example", price: 0.05, asset: "a", network: "base", payee: "0xpayee", terms_hash: "a".repeat(64) };
const saved = { ...process.env };
const realFetch = globalThis.fetch;
const FIXTURE_VARS = ["FIANGSHI_ALLOW_FIXTURE", "FIANGSHI_OFFLINE", "FIANGSHI_REPLAY", "SNAPSHOT_SOURCE", "MOCK_MODELS"];

beforeEach(() => {
  for (const k of FIXTURE_VARS) delete process.env[k]; // a fresh clone: no overrides at all
  process.env.FIANGSHI_DATA_DIR = tmp();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("live by default", () => {
  it("no env overrides: every switch reads live", () => {
    expect(fixtureAllowed()).toBe(false);
    expect([providerMode(), snapshotSource(), isOffline(), replayMode(), mockModels()]).toEqual(["live", "live", false, false, ""]);
    expect(fixtureIgnored()).toEqual([]);
  });
  it("an old .env with fixture settings but no opt-in is ignored, and says so", () => {
    Object.assign(process.env, { FIANGSHI_OFFLINE: "1", FIANGSHI_REPLAY: "1", SNAPSHOT_SOURCE: "fixture", MOCK_MODELS: "good" });
    expect(providerMode()).toBe("live");
    expect(snapshotSource()).toBe("live");
    expect(fixtureIgnored()).toEqual(["FIANGSHI_OFFLINE=1", "FIANGSHI_REPLAY=1", "SNAPSHOT_SOURCE=fixture", "MOCK_MODELS=good"]);
  });
  it("with the opt-in, the offline path is exactly as before", () => {
    Object.assign(process.env, { FIANGSHI_ALLOW_FIXTURE: "1", FIANGSHI_REPLAY: "1" });
    expect(providerMode()).toBe("fixture");
    Object.assign(process.env, { FIANGSHI_REPLAY: "0", FIANGSHI_OFFLINE: "1", MOCK_MODELS: "good", SNAPSHOT_SOURCE: "fixture" });
    expect([providerMode(), snapshotSource(), isOffline()]).toEqual(["mock", "fixture", true]);
  });
  it("a check with no overrides calls SERV over HTTP (observed at the fetch boundary)", async () => {
    Object.assign(process.env, { SERV_REASONING_API_KEY: "test-key-not-real", SERV_MODEL: "test-model", DOLPHIN_API_KEY: "", FIANGSHI_MODEL_TIMEOUT_MS: "200" });
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ error: "stubbed" }), { status: 500 });
    }) as typeof fetch;
    const d = await evaluate(TERMS, clean(), LABELS);
    expect(calls.some((u) => u.endsWith("/chat/completions") && u.startsWith(process.env.SERV_BASE_URL ?? "https://inference-api.openserv.ai/v1"))).toBe(true);
    expect(d.verdict.band).not.toBe("ALLOW"); // the stub fails, so the check fails closed
  });
});
