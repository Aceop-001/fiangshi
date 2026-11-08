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

export const isOffline = () => env("FIANGHSI_OFFLINE") === "1";
export const snapshotSource = (): "fixture" | "live" => (env("SNAPSHOT_SOURCE", "fixture") === "live" ? "live" : "fixture");
export const mockModels = () => env("MOCK_MODELS");

export const dataDir = () => resolve(ROOT, env("FIANGHSI_DATA_DIR", "data"));
export const artifactsDir = () => resolve(ROOT, env("FIANGHSI_ARTIFACTS_DIR", "artifacts"));
export const fixturesDir = () => resolve(ROOT, "fixtures");
export const policyTtlHours = () => num("FIANGHSI_POLICY_TTL_HOURS", 72);
export const PROBE_TIMEOUT_MS = 15_000;
