/**
 * Endpoint signals for a URL that did not answer with usable x402 terms (post-deadline, 2026-11-19).
 *
 * Deterministic facts only, no model call, no vow: the status chain, redirects, TLS, the content type, whether
 * machine-readable terms were found and whether a payee is known. They let /v1/preview explain an endpoint it cannot
 * judge (class UNVERIFIED_ENDPOINT) instead of abstaining in silence. They never produce a band: an endpoint
 * without a census record and terms is never ALLOW.
 *
 * Budget: each hop and the TLS handshake time out on their own, and the whole collection stops at `budgetMs`; a slow
 * target yields the signals gathered so far plus `timeout: true`, never a hang.
 */
import { connect } from "node:tls";
import { parse402 } from "./adapters/probe.js";

export type Signal = { name: string; value: string | number | boolean | null | Record<string, string>; detail?: string };

export interface SignalDeps {
  fetch: typeof fetch;
  tls: (host: string, timeoutMs: number) => Promise<{ valid: boolean; issuer: string | null; days_to_expiry: number | null; error?: string }>;
  isCensusPayee: (payee: string) => boolean;
}

const MAX_HOPS = 5;

/** The certificate a TLS client is shown: whether it verifies, who issued it and how long it has left. */
export function tlsInfo(host: string, timeoutMs: number): ReturnType<SignalDeps["tls"]> {
  return new Promise((resolve) => {
    const s = connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs });
    const done = (r: Awaited<ReturnType<SignalDeps["tls"]>>) => {
      s.destroy();
      resolve(r);
    };
    s.once("secureConnect", () => {
      const c = s.getPeerCertificate();
      const exp = c?.valid_to ? Date.parse(c.valid_to) : NaN;
      done({
        valid: s.authorized,
        issuer: (c?.issuer?.O as string | undefined) ?? (c?.issuer?.CN as string | undefined) ?? null,
        days_to_expiry: Number.isFinite(exp) ? Math.floor((exp - Date.now()) / 86_400_000) : null,
        error: s.authorized ? undefined : String(s.authorizationError ?? "unverified"),
      });
    });
    s.once("timeout", () => done({ valid: false, issuer: null, days_to_expiry: null, error: "timeout" }));
    s.once("error", (e) => done({ valid: false, issuer: null, days_to_expiry: null, error: e.message }));
  });
}

const statusClass = (s: number) => `${Math.floor(s / 100)}xx`;

export async function endpointSignals(url: string, deps: SignalDeps, budgetMs = 12_000): Promise<Signal[]> {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  const out: Signal[] = [];
  const hops: { url: string; status: number }[] = [];
  let cur = url;
  let last: { status: number; headers: Record<string, string>; text: string } | null = null;
  let timedOut = false;
  let unreachable: string | null = null;

  for (let i = 0; i <= MAX_HOPS; i++) {
    if (left() < 500) {
      timedOut = true;
      break;
    }
    try {
      const res = await deps.fetch(cur, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(Math.min(8_000, left())) });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      const text = res.status >= 300 && res.status < 400 ? "" : (await res.text()).slice(0, 200_000);
      last = { status: res.status, headers, text };
      hops.push({ url: cur, status: res.status });
      const loc = headers.location;
      if (res.status >= 300 && res.status < 400 && loc) {
        cur = new URL(loc, cur).href;
        continue;
      }
      break;
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") timedOut = true;
      else unreachable = err.message;
      break;
    }
  }

  const host = (u: string) => new URL(u).host;
  if (hops.length) {
    out.push({ name: "status_class", value: hops.map((h) => statusClass(h.status)).join(" → "), detail: hops.map((h) => h.status).join(" → ") });
    const redirects = hops.length - 1;
    const cross = hops.slice(1).filter((h, i) => host(h.url) !== host(hops[i]!.url)).length;
    out.push({ name: "redirect_hops", value: redirects });
    out.push({ name: "cross_domain_hops", value: cross });
    out.push({ name: "final_host", value: host(hops[hops.length - 1]!.url) });
  } else out.push({ name: "status_class", value: "unreachable", detail: unreachable ?? (timedOut ? "timeout" : "no response") });

  if (last) {
    const ct = (last.headers["content-type"] ?? "").split(";")[0]!.trim() || null;
    out.push({ name: "content_type", value: ct });
    let parses = false;
    try {
      JSON.parse(last.text);
      parses = last.text.trim() !== "";
    } catch {
      /* not JSON */
    }
    out.push({ name: "json_parses", value: parses });
    // machine-readable terms anywhere along the chain's end
    let terms: "found" | "unparseable" | "absent" = "absent";
    let payee: "known" | "unknown" | "absent" = "absent";
    if (last.status === 402) {
      let body: unknown = last.text;
      try {
        body = JSON.parse(last.text);
      } catch {
        /* keep text */
      }
      const pr = parse402({ url: hops[hops.length - 1]!.url, status: 402, headers: last.headers, body });
      terms = pr.ok ? "found" : "unparseable";
      if (pr.ok) payee = deps.isCensusPayee(pr.terms.payee) ? "known" : "unknown";
    }
    out.push({ name: "machine_terms", value: terms, detail: terms === "absent" ? `final response is ${last.status}, not a 402` : undefined });
    out.push({ name: "payee", value: payee });
  }

  if (/^https:/i.test(url) && left() > 500) {
    const t = await deps.tls(host(url), Math.min(4_000, left()));
    out.push({ name: "tls_valid", value: t.valid, detail: t.error });
    out.push({ name: "tls_issuer", value: t.issuer });
    out.push({ name: "tls_days_to_expiry", value: t.days_to_expiry });
  } else if (/^http:/i.test(url)) out.push({ name: "tls_valid", value: false, detail: "plain http" });

  if (timedOut || left() <= 0) out.push({ name: "timeout", value: true, detail: `stopped at the ${budgetMs} ms budget` });
  return out;
}

/** One sentence for `reason`, from the signals. */
export function signalsReason(sig: Signal[]): string {
  const g = (n: string) => sig.find((s) => s.name === n)?.value;
  if (g("status_class") === "unreachable") return `unreachable: ${sig.find((s) => s.name === "status_class")?.detail ?? "no response"}`;
  const chain = sig.find((s) => s.name === "status_class")?.detail ?? "";
  const terms = g("machine_terms");
  const what = terms === "found" ? "x402 terms found only after a redirect" : terms === "unparseable" ? "a 402 without usable terms" : "no machine-readable payment terms";
  return `not an x402 endpoint as given: ${chain} at ${g("final_host") ?? "?"} (${g("content_type") ?? "no content-type"}), ${what}`;
}
