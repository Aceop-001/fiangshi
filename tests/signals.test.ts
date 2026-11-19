// B-lite (post-deadline): deterministic endpoint signals for a URL that is not a 402. No network: fetch and TLS injected.
import { describe, it, expect } from "vitest";
import { endpointSignals, signalsReason, type Signal, type SignalDeps } from "../src/signals.js";
import { noVerdictAnswer, PREVIEW_KEYS } from "../src/preview.js";

const PAYTO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
type R = { status: number; headers?: Record<string, string>; body?: string; delayMs?: number };

function deps(routes: Record<string, R>, census: string[] = []): SignalDeps {
  return {
    fetch: (async (u: string | URL, init?: RequestInit) => {
      const r = routes[String(u)];
      if (!r) throw new Error(`getaddrinfo ENOTFOUND ${new URL(String(u)).host}`);
      if (r.delayMs)
        await new Promise((ok, no) => {
          const t = setTimeout(ok, r.delayMs);
          init?.signal?.addEventListener("abort", () => (clearTimeout(t), no(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
        });
      return new Response(r.status >= 300 && r.status < 400 ? null : (r.body ?? ""), { status: r.status, headers: r.headers ?? {} });
    }) as typeof fetch,
    tls: async () => ({ valid: true, issuer: "Let's Encrypt", days_to_expiry: 60 }),
    isCensusPayee: (p) => census.includes(p),
  };
}
const get = (s: Signal[], n: string) => s.find((x) => x.name === n)?.value;

describe("endpointSignals", () => {
  it("a website behind a cross-domain redirect: status chain, hops, final host, html, no terms", async () => {
    const s = await endpointSignals("https://openserv.example", deps({
      "https://openserv.example": { status: 308, headers: { location: "https://www.openserv.example/" } },
      "https://www.openserv.example/": { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: "<html></html>" },
    }));
    expect(get(s, "status_class")).toBe("3xx → 2xx");
    expect(get(s, "redirect_hops")).toBe(1);
    expect(get(s, "cross_domain_hops")).toBe(1);
    expect(get(s, "final_host")).toBe("www.openserv.example");
    expect(get(s, "content_type")).toBe("text/html");
    expect(get(s, "json_parses")).toBe(false);
    expect(get(s, "machine_terms")).toBe("absent");
    expect(get(s, "payee")).toBe("absent");
    expect(get(s, "tls_valid")).toBe(true);
    expect(signalsReason(s)).toMatch(/308 → 200 at www.openserv.example \(text\/html\), no machine-readable payment terms/);
  });
  it("terms found only after a redirect: reported, payee looked up in the census, still no band", async () => {
    const body = JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10000", payTo: PAYTO, asset: USDC }] });
    const s = await endpointSignals("https://a.example/x", deps({
      "https://a.example/x": { status: 301, headers: { location: "/y" } },
      "https://a.example/y": { status: 402, headers: { "content-type": "application/json" }, body },
    }, [PAYTO.toLowerCase()]));
    expect(get(s, "cross_domain_hops")).toBe(0);
    expect(get(s, "machine_terms")).toBe("found");
    expect(get(s, "payee")).toBe("known");
  });
  it("unreachable host", async () => {
    const s = await endpointSignals("https://gone.example", deps({}));
    expect(get(s, "status_class")).toBe("unreachable");
    expect(signalsReason(s)).toMatch(/^unreachable: getaddrinfo ENOTFOUND/);
  });
  it("a slow target stops at the budget with what it has, never hangs", async () => {
    const t0 = Date.now();
    const s = await endpointSignals("https://slow.example", deps({ "https://slow.example": { status: 200, delayMs: 60_000 } }), 1_500);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(get(s, "timeout")).toBe(true);
  });
  it("redirect loops stop after 5 hops", async () => {
    const s = await endpointSignals("https://loop.example/a", deps({
      "https://loop.example/a": { status: 302, headers: { location: "/b" } },
      "https://loop.example/b": { status: 302, headers: { location: "/a" } },
    }));
    expect(get(s, "redirect_hops")).toBe(5);
  });
});

describe("the preview answer for an endpoint it cannot judge", () => {
  it("UNVERIFIED_ENDPOINT keeps the one schema, carries the signals, and has no band", () => {
    const sig: Signal[] = [{ name: "status_class", value: "2xx" }];
    const a = noVerdictAnswer("https://x.example", "not an x402 endpoint", { ok: false, why: "off" }, "UNVERIFIED_ENDPOINT", sig);
    expect(Object.keys(a).sort()).toEqual([...PREVIEW_KEYS].sort());
    expect(a.class).toBe("UNVERIFIED_ENDPOINT");
    expect(a.verdict).toBe("no_verdict");
    expect(a.score).toBeNull();
    expect(a.signals).toEqual(sig);
    expect(a.model_calls).toBe(0);
  });
});
