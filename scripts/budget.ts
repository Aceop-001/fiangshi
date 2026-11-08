/**
 * Budget guard. EVERY outbound data call goes through guarded().
 * - refuses all live calls when FIANGHSI_OFFLINE=1
 * - increments a counter file BEFORE the call (failed calls still count)
 * - refuses call N+1 past the cap
 * - appends one line per call / refusal to artifacts/costs.md
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { artifactsDir, dataDir, isOffline, num } from "../src/config.js";

export type Provider = "surf" | "serv" | "dolphin" | "kite";

export const capFor = (p: Provider): number =>
  ({
    surf: num("FIANGHSI_MAX_SURF_CALLS", 60),
    serv: num("FIANGHSI_MAX_SERV_CALLS", 100),
    dolphin: num("FIANGHSI_MAX_DOLPHIN_CALLS", 30),
    kite: num("FIANGHSI_MAX_KITE_CALLS", 1),
  })[p];

export class BudgetExceeded extends Error {}
export class OfflineRefused extends Error {}

export interface GuardOpts {
  counterPath?: string;
  costsPath?: string;
  cap?: number;
  /** Tests only: exercise the counter without the offline refusal. The wrapped fn must not touch the network. */
  ignoreOffline?: boolean;
}

export interface CallResult<T> {
  value: T;
  units?: number | null; // credits / tokens reported by the provider, when present
}

type Counter = Partial<Record<Provider, number>>;

const readCounter = (p: string): Counter => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Counter) : {});

function costLine(path: string, line: string) {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "# Costs ledger\n\n| time | provider | label | call # / cap | units | status |\n|---|---|---|---|---|---|\n");
  appendFileSync(path, line + "\n");
}

export function usage(provider: Provider, counterPath = join(dataDir(), "budget.json")): number {
  return readCounter(counterPath)[provider] ?? 0;
}

export async function guarded<T>(provider: Provider, label: string, fn: () => Promise<CallResult<T>>, opts: GuardOpts = {}): Promise<T> {
  if (isOffline() && !opts.ignoreOffline) throw new OfflineRefused(`offline: refusing live ${provider} call (${label})`);
  const counterPath = opts.counterPath ?? join(dataDir(), "budget.json");
  const costsPath = opts.costsPath ?? join(artifactsDir(), "costs.md");
  const cap = opts.cap ?? capFor(provider);
  const counter = readCounter(counterPath);
  const n = (counter[provider] ?? 0) + 1;
  const now = new Date().toISOString();
  if (n > cap) {
    costLine(costsPath, `| ${now} | ${provider} | ${label} | ${n}/${cap} | - | REFUSED |`);
    throw new BudgetExceeded(`budget: ${provider} call ${n} exceeds cap ${cap}`);
  }
  counter[provider] = n;
  mkdirSync(dirname(counterPath), { recursive: true });
  writeFileSync(counterPath, JSON.stringify(counter, null, 2));
  try {
    const r = await fn();
    costLine(costsPath, `| ${now} | ${provider} | ${label} | ${n}/${cap} | ${r.units ?? "n/a"} | ok |`);
    return r.value;
  } catch (e) {
    costLine(costsPath, `| ${now} | ${provider} | ${label} | ${n}/${cap} | - | error: ${(e as Error).name} |`);
    throw e;
  }
}
