/**
 * Identity v3 corroboration (2026-11-09, as specified). Pure.
 * Scale (I component), identity neutrality 2026-11-09: no claim -> excluded · claim with 0 sources -> excluded (identical to
 * no claim: extraction must never penalise being examined) · 1 independent source -> 0.5 · 2+ sources -> 0.75 · contradicted -> V5 BLOCK
 * Sources: the 402 resource URL host, a URL path segment, the catalog listing name (when the claim came from elsewhere),
 * a Surf wallet label, and SERV/Dolphin agreement (hook; SERV emits no identity claim yet, so it is never set).
 * A claim must never be corroborated by the text it was extracted from (no circular evidence).
 */
export type CorroborationSource = "host" | "path" | "catalog" | "label" | "model_agreement";

/** Tokens too generic to identify anyone. */
const STOP = new Set(["api", "apis", "app", "the", "and", "for", "data", "service", "services", "x402", "inc", "llc", "ltd", "com", "www", "net", "org", "official", "agent", "agents", "tool", "tools", "gateway", "server", "endpoint"]);

export function tokens(s: string | null | undefined): string[] {
  if (!s) return [];
  return [...new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !STOP.has(w)))];
}

export interface CorroborationInput {
  claims: (string | null | undefined)[]; // claimed org / product names
  claimFrom: "catalog" | "dolphin" | "label" | null; // where the claim text came from
  url?: string | null; // the 402 resource URL
  catalogName?: string | null; // the Bazaar serviceName for this payee
  labelName?: string | null; // Surf entity_name
  modelAgreement?: boolean; // SERV and Dolphin name the same entity (hook)
}

export function corroborate(i: CorroborationInput): CorroborationSource[] {
  const ct = tokens(i.claims.filter(Boolean).join(" "));
  if (!ct.length) return [];
  const out: CorroborationSource[] = [];
  let host = "";
  let path: string[] = [];
  try {
    const u = new URL(i.url ?? "");
    host = u.host.toLowerCase();
    path = tokens(decodeURIComponent(u.pathname));
  } catch {
    /* no url */
  }
  const hostParts = host.split(/[.-]/).filter(Boolean);
  if (host && ct.some((w) => hostParts.some((h) => h === w || (h.length >= 5 && h.includes(w)) || (w.length >= 5 && w.includes(h) && h.length >= 4)))) out.push("host");
  if (path.length && ct.some((w) => path.includes(w))) out.push("path");
  if (i.claimFrom !== "catalog" && i.catalogName && tokens(i.catalogName).some((w) => ct.includes(w))) out.push("catalog");
  if (i.claimFrom !== "label" && i.labelName && tokens(i.labelName).some((w) => ct.includes(w))) out.push("label");
  if (i.modelAgreement) out.push("model_agreement");
  return out;
}

/** I component in [0, 0.75]. Backward compatible: corroborated=true without a source list counts as one source. */
export function identityLevel(hasClaim: boolean, sources: string[] | undefined, corroborated: boolean | null): number | null {
  if (!hasClaim) return null;
  const n = sources ? new Set(sources).size : corroborated === true ? 1 : 0;
  return n === 0 ? null : n === 1 ? 0.5 : 0.75;
}

/** A wallet label as Surf returns it. */
export interface WalletLabelRef {
  entity_name?: string | null;
  entity_type?: string | null;
}

/**
 * The name a label gives to the wallet's OPERATOR, or null when the label does not say who runs the wallet (2026-11-10):
 *  - no entity_type: the kind of label is unknown;
 *  - "individual": a person's handle. People sell products under other names, so a handle contradicts nothing;
 *  - a deposit address ("casino_deposit", "OKX Deposit"): it names the platform where the owner is a customer.
 * Only an operator label ("Kraken", "Binance") can contradict a claimed name. A BLOCK needs a label that says
 * "this wallet is X's", not merely a label that shares no word with the listing.
 */
export function operatorName(l: WalletLabelRef | null | undefined): string | null {
  const name = l?.entity_name?.trim();
  const type = l?.entity_type?.trim().toLowerCase();
  if (!name || !type) return null;
  if (type === "individual") return null;
  if (type.includes("deposit") || /\bdeposit$/i.test(name)) return null;
  return name;
}

/**
 * The label names the wallet's operator, and NONE of its tokens appear in the claim: the claim is contradicted (V5 BLOCK).
 * Pass operatorName(label), never a raw entity_name: a person's handle or a deposit address is not an operator.
 */
export function contradicts(claims: (string | null | undefined)[], operator: string | null | undefined): boolean {
  const ct = tokens(claims.filter(Boolean).join(" "));
  const lt = tokens(operator);
  return ct.length > 0 && lt.length > 0 && !lt.some((w) => ct.includes(w));
}
