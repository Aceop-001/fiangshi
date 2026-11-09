/** List SERV model ids (GET {SERV_BASE_URL}/models). Read-only; never prints the key. Usage: npx tsx scripts/serv-models.ts */
import { env, loadDotEnv } from "../src/config.js";

loadDotEnv();
const key = env("SERV_REASONING_API_KEY");
const base = env("SERV_BASE_URL", "https://inference-api.openserv.ai/v1").replace(/\/$/, "");
if (!key) {
  console.error("SERV_REASONING_API_KEY not set");
  process.exit(3);
}
const t = Date.now();
const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
console.log(`GET /models -> HTTP ${res.status} in ${Date.now() - t}ms`);
if (!res.ok) process.exit(1); // body not echoed: it may reflect the key
const raw = (await res.json()) as Record<string, unknown> | unknown[];
const list = (Array.isArray(raw) ? raw : ((raw.items ?? raw.data ?? raw.models ?? []) as unknown[])) as { id?: string; [k: string]: unknown }[];
console.log(`shape: ${Array.isArray(raw) ? "array" : "object keys {" + Object.keys(raw).join(", ") + "}"}; entries: ${list.length}; first entry keys: ${list[0] ? Object.keys(list[0]).join(", ") : "-"}`);
const j = { data: list.map((m) => ({ ...m, id: `${String(m.modelId ?? m.id ?? m.name ?? "?")} [${String(m.provider ?? "")}] endpoints=${JSON.stringify(m.endpoints ?? "")}` })) };
for (const m of j.data ?? []) {
  const extra = Object.entries(m).filter(([k]) => /price|pricing|cost|context/i.test(k)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
  console.log(`${m.id}${extra ? "  " + extra : ""}`);
}
