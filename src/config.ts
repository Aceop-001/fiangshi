/** Env + paths. Read lazily so tests can override process.env. Never logs values of keys. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/config.ts -> repo root; dist/src/config.js -> dist -> repo root.
export const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..").replace(/[\\/]dist$/, "");

let loaded = false;
/** Minimal .env loader (no dependency). Existing env vars win. */
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
  }
}

export const env = (k: string, d = ""): string => process.env[k] ?? d;
export const num = (k: string, d: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== "" && process.env[k] !== undefined ? v : d;
};

export const isOffline = () => env("FIANGSHI_OFFLINE") === "1";
export const snapshotSource = (): "fixture" | "live" => (env("SNAPSHOT_SOURCE", "fixture") === "live" ? "live" : "fixture");
export const mockModels = () => env("MOCK_MODELS");

export const dataDir = () => resolve(ROOT, env("FIANGSHI_DATA_DIR", "data"));
export const artifactsDir = () => resolve(ROOT, env("FIANGSHI_ARTIFACTS_DIR", "artifacts"));
export const fixturesDir = () => resolve(ROOT, "fixtures");
/**
 * Fixture (replay) mode: probes read recorded raw 402s (fixtures/402, fixtures/402/real) and SERV/Dolphin replay recorded
 * responses (fixtures/recorded/{serv,dolphin}) through the real validators, vows and receipt chain. A missing recording
 * fails closed exactly like a provider failure; nothing ever falls through to the network.
 */
export const replayMode = () => env("FIANGSHI_REPLAY") === "1";
export const replayDir = () => resolve(fixturesDir(), "recorded");
export const providerMode = (): "fixture" | "mock" | "live" =>
  replayMode() ? "fixture" : env("FIANGSHI_OFFLINE") === "1" || env("MOCK_MODELS") !== "" ? "mock" : "live";
export const policyTtlHours = () => num("FIANGSHI_POLICY_TTL_HOURS", 72);
/** Static edition (GitHub Pages): pages are pre-built by scripts/export-static.ts, so nothing that needs a live server is offered. */
export const staticSite = () => env("FIANGSHI_STATIC") === "1";
export const PROBE_TIMEOUT_MS = 15_000;
