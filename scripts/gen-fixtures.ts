/**
 * Deterministic SYNTHETIC fixture generator (no randomness, no clock, no network).
 * Writes fixtures/402/*.json, fixtures/payees.json, fixtures/funders.json, fixtures/model/*.json.
 *
 * These are stand-ins shaped like x402 v1 402 responses and PayeeSignals. They are NOT recorded from
 * real endpoints. TODO(api-wiring): replace fixtures/402 with 10 real recorded unpaid responses.
 * Run: npx tsx scripts/gen-fixtures.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures");
const addr = (name: string) => "0x" + createHash("sha256").update(name).digest("hex").slice(0, 40);
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const F = {
  coinbase: addr("funder:cex:coinbase"),
  kraken: addr("funder:cex:kraken"),
  mixer: addr("funder:mixer:1"),
  sybilRoot: addr("funder:sybil:root"),
  sybil1: addr("funder:sybil:1"),
  sybil2: addr("funder:sybil:2"),
  fresh: (n: string) => addr("funder:fresh:" + n),
};

interface Spec {
  name: string;
  age: number | null;
  tx: number | null;
  funder: string | null;
  funderNote: string;
  distinct: number | null;
  repeat: number | null;
  usd: number | null;
  listings: number | null;
  conc: number | null;
  dormancy: number | null;
  org: string | null;
  product: string | null;
  corroborated: boolean | null;
  bio?: string;
}

function signals(s: Spec) {
  const payee = addr("payee:" + s.name);
  const ev: Record<string, string> = {};
  if (s.age !== null) ev.wallet_age_hours = `first inbound tx ${s.age}h before snapshot (base)`;
  if (s.tx !== null) ev.tx_count = `${s.tx} transactions on base`;
  if (s.funder !== null) ev.first_funder = `first funded by ${s.funder} (${s.funderNote})`;
  if (s.distinct !== null) ev.distinct_payers = `${s.distinct} distinct payer addresses, ${s.repeat ?? 0} repeat`;
  if (s.usd !== null) ev.total_received_usd = `$${s.usd.toFixed(2)} USDC received`;
  if (s.org || s.product) ev.identity = s.bio ?? `seller bio: "${s.org ?? ""} - ${s.product ?? ""}"`;
  return {
    payee,
    wallet_age_hours: s.age,
    tx_count: s.tx,
    first_funder: s.funder,
    funder_fanout: 0, // recomputed by the snapshot builder from the catalog
    distinct_payers: s.distinct,
    repeat_payers: s.repeat,
    total_received_usd: s.usd,
    appears_in_other_listings: s.listings,
    token_concentration: s.conc,
    dormancy_days: s.dormancy,
    identity: { claims_org: s.org, claims_product: s.product, corroborated: s.corroborated },
    evidence: ev,
  };
}

const ORGS = ["Weatherly Data", "Parcel Atlas", "Lexicon Labs", "Tidewater Maps", "Quarry Search", "Northbeam Quotes", "Ferro Translate", "Gullwing OCR", "Basalt Geocode", "Marigold News"];
const controls: Spec[] = ORGS.map((org, i) => ({
  name: `ctrl-${String(i + 1).padStart(2, "0")}`,
  age: 3000 + i * 600,
  tx: 400 + i * 250,
  funder: i % 2 === 0 ? F.coinbase : F.kraken,
  funderNote: i % 2 === 0 ? "Coinbase hot wallet" : "Kraken hot wallet",
  distinct: 60 + i * 30,
  repeat: 20 + i * 5,
  usd: 1200 + i * 950.5,
  listings: 1,
  conc: 0.1 + (i % 3) * 0.05,
  dormancy: i % 4,
  org,
  product: `${org.split(" ")[0]} API`,
  corroborated: true,
}));

const archetypes: Spec[] = [
  { name: "burner", age: 20, tx: 6, funder: F.fresh("burner"), funderNote: "fresh wallet", distinct: 2, repeat: 0, usd: 0.4, listings: 0, conc: 0.95, dormancy: 0, org: null, product: null, corroborated: null },
  ...["a", "b", "c", "d"].map((x, i): Spec => ({
    name: `sybil-${x}`, age: 900 + i * 10, tx: 120, funder: i < 2 ? F.sybil1 : F.sybil2, funderNote: "unlabelled wallet",
    distinct: 15, repeat: 4, usd: 90, listings: 3, conc: 0.3, dormancy: 1, org: null, product: null, corroborated: null,
  })),
  { name: "migrator", age: 30, tx: 12, funder: F.fresh("migrator"), funderNote: "fresh wallet", distinct: 1, repeat: 0, usd: 0.1, listings: 0, conc: 0.2, dormancy: 0, org: "Weatherly Data", product: "Weatherly API", corroborated: true, bio: 'seller bio: "Weatherly Data - moved to a new wallet"' },
  { name: "sleeper", age: 6000, tx: 40, funder: F.fresh("sleeper"), funderNote: "fresh wallet", distinct: 3, repeat: 1, usd: 12, listings: 0, conc: 0.7, dormancy: 120, org: null, product: null, corroborated: null },
  { name: "lookalike", age: 60, tx: 30, funder: F.fresh("lookalike"), funderNote: "fresh wallet", distinct: 4, repeat: 0, usd: 3, listings: 2, conc: 0.4, dormancy: 0, org: "Weatherly Data", product: "Weatherly API", corroborated: false, bio: 'seller bio: "Weatherly Data official - hourly weather API"' },
];

const misc: Spec[] = [
  { name: "mixer-fed", age: 3000, tx: 500, funder: F.mixer, funderNote: "mixer output", distinct: 80, repeat: 20, usd: 4000, listings: 1, conc: 0.2, dormancy: 0, org: null, product: null, corroborated: null },
  { name: "no-history", age: 800, tx: 20, funder: F.coinbase, funderNote: "Coinbase hot wallet", distinct: 0, repeat: 0, usd: 0, listings: 0, conc: 0.5, dormancy: 0, org: null, product: null, corroborated: null },
  { name: "silent", age: 1500, tx: 200, funder: null, funderNote: "", distinct: 30, repeat: 5, usd: 300, listings: 0, conc: null, dormancy: 0, org: null, product: null, corroborated: null },
  ...Array.from({ length: 10 }, (_, i): Spec => ({
    name: `indie-${String(i + 1).padStart(2, "0")}`,
    age: 400 + i * 350,
    tx: 50 + i * 60,
    funder: F.fresh("indie-" + i),
    funderNote: "fresh wallet",
    distinct: 5 + i * 8,
    repeat: i * 2,
    usd: 25 + i * 120,
    listings: i % 2,
    conc: 0.6 - i * 0.04,
    dormancy: i % 5,
    org: null,
    product: null,
    corroborated: null,
  })),
];

const all = [...controls, ...archetypes, ...misc];
const payees = all.map(signals);
const payeeOf = (name: string) => addr("payee:" + name);

// 10 x402 v1 unpaid responses. One payee ("ghost") is intentionally absent from payees.json.
const endpoints: [string, string, string][] = [
  ["ctrl-01", "https://api.weatherly.example/v1/forecast", "50000"],
  ["ctrl-02", "https://api.parcelatlas.example/v1/parcel", "20000"],
  ["ctrl-03", "https://api.lexicon.example/v1/define", "10000"],
  ["ctrl-04", "https://api.tidewater.example/v1/tiles", "50000"],
  ["burner", "https://fresh-oracle.example/v1/price", "50000"],
  ["sybil-a", "https://swarm-a.example/v1/search", "30000"],
  ["lookalike", "https://weatherly-official.example/v1/forecast", "50000"],
  ["no-history", "https://premium-signals.example/v1/alpha", "1000000"],
  ["sleeper", "https://old-quotes.example/v1/quote", "40000"],
  ["ghost", "https://unknown-seller.example/v1/data", "50000"],
];

function raw402(name: string, url: string, amount: string) {
  return {
    url,
    status: 402,
    headers: { "content-type": "application/json" },
    body: {
      x402Version: 1,
      error: "X-PAYMENT header is required",
      accepts: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: amount,
          resource: url,
          description: `synthetic fixture for ${name}`,
          mimeType: "application/json",
          payTo: payeeOf(name),
          maxTimeoutSeconds: 60,
          asset: USDC_BASE,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    },
  };
}

rmSync(join(FIX, "402"), { recursive: true, force: true });
mkdirSync(join(FIX, "402"), { recursive: true });
mkdirSync(join(FIX, "model"), { recursive: true });
endpoints.forEach(([name, url, amt], i) =>
  writeFileSync(join(FIX, "402", `${String(i + 1).padStart(2, "0")}-${name}.json`), JSON.stringify(raw402(name, url, amt), null, 2) + "\n"),
);
writeFileSync(join(FIX, "payees.json"), JSON.stringify(payees, null, 2) + "\n");
writeFileSync(
  join(FIX, "funders.json"),
  JSON.stringify({ labels: { [F.coinbase]: "cex", [F.kraken]: "cex", [F.mixer]: "mixer" }, edges: { [F.sybil1]: F.sybilRoot, [F.sybil2]: F.sybilRoot } }, null, 2) + "\n",
);

// 3 SERV outputs for ctrl-01: good, hallucinated signal, non-substring quote.
const c1 = payees[0]!;
const good = { band: "ALLOW", citations: [{ signal: "wallet_age_hours", quote: c1.evidence.wallet_age_hours }, { signal: "distinct_payers", quote: c1.evidence.distinct_payers }], rationale: "mature, CEX-funded, real repeat payers" };
const halluc = { band: "ALLOW", citations: [{ signal: "kyc_status", quote: "KYC verified" }], rationale: "verified seller" };
const badq = { band: "ALLOW", citations: [{ signal: "distinct_payers", quote: "over 9000 distinct payer addresses" }], rationale: "very popular" };
for (const [n, o] of [["good", good], ["hallucinated", halluc], ["badquote", badq]] as const)
  writeFileSync(join(FIX, "model", `${n}.json`), JSON.stringify({ payee: c1.payee, raw: JSON.stringify(o) }, null, 2) + "\n");

console.log(`wrote ${endpoints.length} 402 fixtures, ${payees.length} payees, 3 model outputs`);
