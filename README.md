# Fiangshi

Fiangshi checks the wallet behind an x402 paid endpoint *before* your agent pays. It returns **ALLOW / REVIEW / BLOCK** with quoted evidence and a hash-chained receipt you can re-verify. Advisory only, and it never holds funds.

> The model advises, the vows decide.

## Quickstart

```bash
cp .env.example .env
npm ci
npm test
npm run accept
npm run localhost-check     # 10-step end-to-end check, FIXTURE mode: zero keys, 127.0.0.1 only
npm run dev                 # the site and the API on http://127.0.0.1:8787 (open it in a browser)
curl "http://127.0.0.1:8787/v1/check?url=https%3A%2F%2Fapi.cleave.fi%2Fx402%2Fgas"
```

Everything above needs **no keys** and touches no network beyond 127.0.0.1:
- `npm test` and `npm run accept` run on committed fixtures under a no-network preload.
- `npm run localhost-check` defaults to **fixture mode**. Recorded 402s (`fixtures/402/real`) and recorded SERV and Dolphin replies (`fixtures/recorded`, made by `npx tsx scripts/record-replay.ts`) are replayed through the real parser, vows and receipt chain. The server runs under the no-network preload, and every response is marked `mode: "fixture"`. A missing recording fails closed; it never falls back to the network.
- `npm run localhost-check -- --live` uses real providers and needs `SERV_REASONING_API_KEY` in `.env`.

`localhost-check` starts its own server on 8787, so stop `npm run dev` first, or set `FIANGSHI_CHECK_PORT`.

## The six vows (frozen)

Vows are deterministic rules that run after the model and can only lower the verdict. Final band = `min(score band, model band, vow band)`.

| vow | rule | band |
|---|---|---|
| **null_payee** (V6) | `payTo` is the zero address, a known burn sink, the payment-asset contract, or fails EIP-55. Checked **at probe time**, before any data or model call | BLOCK |
| **age** | payee first seen < 48 h ago | BLOCK |
| **kinship** | first funder shared with ≥3 other catalog payees; exchange and relayer funders exempt | BLOCK |
| **history** | 0 distinct payers and price > $0.50 | REVIEW |
| **identity** (V5) | claimed name contradicted by a label that names the wallet operator (a person handle or a deposit address contradicts nothing). An uncorroborated claim is treated exactly like no claim (identity neutrality) | BLOCK |
| **silence** | a required Surf signal is missing | REVIEW |

**Live example: `api.cleave.fi/x402/gas`.** Its 402 asks for **$0.80** (the catalog said $5.00) to be paid to `0x0000…0000`, the zero address, where money is unrecoverable. On the rubric alone it scored 80.9, an ALLOW. V6 BLOCKs it at probe time with a sealed receipt, **$0.00 cost and 0 model calls** (`npm run localhost-check`, step 3).

## Numbers (all from committed scripts)

| | value | source |
|---|---|---|
| census coverage | **800 of 1,923 Base payees, 90-day window** (41.6%) | `npx tsx scripts/audit.ts report --sample fixtures/audit/sample-census.json --days 90` → `artifacts/audit.md` |
| bands | **49 ALLOW · 465 REVIEW · 286 BLOCK** | same; also `GET /v1/index.json` |
| ALLOW composition | 12 no claim · 5 claim with 0 sources · 26 with 1 source · 6 with 2+ | `npx tsx scripts/allow-composition.ts` |
| kinship BLOCKs | 243, all on funders Surf could not name (an upper bound) | same |
| probe check | 123 live 402s parsed, **0 payee mismatches** (live `payTo` = catalog) | `audit.ts probe` → `fixtures/audit/probes.jsonl` |
| adversarial lab | **8 / 9** cases match expectations written before the run; 3 / 3 real controls ALLOW. B4 is a recorded FAILURE: it is still REVIEW, but identity neutrality means V5 no longer fires on it | `scripts/build-lab.ts` + `scripts/matrix.ts` → `artifacts/lab.md` |
| tests | 250 passing; accept 11 / 11 | `npm test`, `npm run accept` |
| localhost end to end | 10 / 10 PASS in fixture mode (no keys) and in live mode | `npm run localhost-check [-- --live]` |

These are the only band counts the repo states; every page (README, `artifacts/audit.md`, `artifacts/capability.md`, the index) shows the same split. Earlier rule sets live in git history.

## Latency and price

| | latency | price |
|---|---|---|
| V6 BLOCK (null payee) | one unpaid probe, no model call | **$0.00** |
| cached check (payee in the census) | **warm p50 333 ms** in the latest live run (`artifacts/demo-stats.json`, 2026-11-10, 3 calls). The live unpaid probe dominates and depends on the seller's own response time: the six runs committed so far ranged from 294 to 935 ms (`git log -p artifacts/demo-stats.json`) | **$0.05** (`FIANGSHI_PRICE_CHECK`) |
| first check of a census payee (no cached model reply) | up to ~25 s when Dolphin times out twice (12 s + one retry) | **$0.05** |
| cold check (payee not in the census: Surf + SERV + Dolphin) | **not served in this build.** The route makes no live data call, so such a payee answers REVIEW through the silence vow | **$0.15** is the price worked out for it (`FIANGSHI_PRICE_CHECK_COLD`, `scripts/pricing.ts`); today the route charges $0.05 |
| payee record `/v1/payee/:addr` | census lookup | **$0.02** (`FIANGSHI_PRICE_PAYEE`) |

Cost basis (`npx tsx scripts/pricing.ts`, details in `artifacts/costs.md`): a cached check costs $0.0019 in model calls; a cold one costs $0.0979 measured, or $0.1159 if Surf's `meta.credits_used` is taken at face value.

## The site (127.0.0.1:8787)

Five static pages, served by the same process as the API. No JavaScript, no framework, no CDN, no external request: a Content-Security-Policy of `default-src 'none'` enforces it in the browser (`tests/api.test.ts`).

| page | what it shows |
|---|---|
| `/` | The census (band counts and a score histogram split by final band), five case files, the six vows with how often each fired, shared funders, and all 800 payees with their receipts. |
| `/check?url=` | A free probe from a plain form: one unpaid GET, the null-payee gate, and the cached census band. It never calls a model and shows only what `/v1/index.json` and `/v1/receipt/:id` already give away. |
| `/receipt/:id` | A receipt as a paper slip, with the result of recomputing its hash and chain link. |
| `/docs` | [docs/GUIDE.md](docs/GUIDE.md): the agent flow with real requests and responses, how a verdict is made, the routes, the receipt fields, limits. A test checks every example against the running server. |
| `/legal` | [docs/LEGAL.md](docs/LEGAL.md): terms of use, what a verdict about a seller does and does not say, privacy, licence. It ends with the operator contact from `FIANGSHI_CONTACT`. |

Code: `src/site.ts` (pages), `src/site-theme.ts` (logo, styles, shell) and `src/md.ts` (the small Markdown renderer for the two documents). Verdict colours are white (ALLOW), grey (REVIEW) and red (BLOCK), each with its own shape and a text label, so no verdict depends on telling red from green.

## API (127.0.0.1:8787)

| route | price | notes |
|---|---|---|
| `GET /`, `GET /check?url=`, `GET /receipt/:id`, `GET /docs`, `GET /legal` | free | the site above |
| `GET /health`, `GET /v1/index.json` | free | census payees with band, score and receipt id |
| `GET /v1/check?url=` | $0.05 | V6 payees answer BLOCK free; otherwise a real x402 v2 402 until `X-PAYMENT` is sent |
| `GET /v1/payee/:addr` | $0.02 | x402 v2 402, then the census record |
| `GET /v1/receipt/:id`, `GET /v1/verify?id=` or `?receipt=` | free | `receipt` = base64url receipt JSON; one changed byte → `valid:false` |
| `GET /v1/badge/:addr.svg` | free | badge coloured by band |

Settlement is **dry-run**. `X-PAYMENT` is checked for structure only; the signature is not verified and no tx hash is ever invented. Paid routes stay disabled until `FIANGSHI_PAYTO` (your wallet, which must pass V6) is set. `localhost-check` uses an EIP-55 spec vector when it isn't set.

## Limits

- **90-day window.** Wallet age is a lower bound: first seen within 90 days.
- **Unnamed funders.** Surf names few funders. The six largest shared-funder clusters are unnamed, so kinship BLOCKs are an upper bound.
- **No live payee under 48 h.** 0 of 800 census payees are that young, so the age vow is tested on fixtures but has not fired live.
- **Label coverage is thin.** 16 of 463 addresses got a Surf label (3.5%). Missing or uncorroborated identity is scored as neutral (weight excluded), not as trust and not as a penalty.
- Dolphin identity extraction is **optional enrichment**. A timeout is stamped `enrichment: incomplete` on the receipt and never caps the verdict.
- Receipts are hash-chained (`sha256` + `prev_hash`), **not signed**.

## NOT doing

No dashboard, auth, admin panel or DB server. No custody, signing or sending of transactions. No per-entity API loops. No real settlement in this build.

## Provider quirks (found on live calls, 2026-11-08/09)

- **Dolphin (DeepSeek V4.1 Flash) returns an undocumented `reasoning` field.** On the first live call it used all 200 output tokens and left the JSON answer empty (`finish_reason=length`). The token cap is now 1,024. Completions often take over 12 s while `/models` answers in 0.3 s. Fiangshi waits 12 s plus one retry, then caches the timeout for an hour.
- **SERV returns no cost field.** Chat completions carry only `usage` tokens. Cost is tokens × the `/models` price, which is in cents per million tokens (`"input": 100` = $1.00/M). The model list is under `items[]` with `modelId`.
- **SERV chat completions have no reasoning field.** Fiangshi requires its own `rationale` field through a strict `json_schema`.
- **Surf async jobs have an undocumented scan ceiling, and rejections are billed.** Preflight accepted a query that the async job then rejected with `QUERY_FAILED: scans too many rows or bytes`, charging 4 credits.
- **Surf sync refusals and killed calls are billed.** `SYNC_QUERY_REQUIRES_ASYNC` cost 4 credits, as did a call cut off at 25 s. A slow sync call can leave the next one refused with `SQL_QUERY_IN_FLIGHT`.
- **Surf's `meta.credits_used` is not the bill.** It says 5 for a keyed SQL call that costs 4, and 1 for a label call that costs 4. Trust the balance delta.
- **`wallet-labels-batch` fails above about 20 addresses** (docs say 100) with `{"error_code":"INTERNAL_ERROR","success":false}`. Fiangshi fails closed on that shape and sends groups of 20.

## Design decisions (where the spec is silent)

- A degraded model counts as REVIEW. A model BLOCK is applied as REVIEW, because a BLOCK needs a machine-checkable reason.
- Invalid data (negative ages, future timestamps, NaN, self-funding) is cleaned to "missing", which triggers silence and REVIEW. Data errors never BLOCK.
- Identity neutrality: extraction must never penalise being examined. No claim and an uncorroborated claim both exclude the identity weight. 1 source gives 0.5, 2+ give 0.75, and only a contradicted claim BLOCKs (V5). Optional components can only raise a score.
- The reported `vow_fired` is the most severe vow that fired. Ties go by listed order.

## Build Log

- **2026-11-08 Phase 0.** Skeleton with TS strict, vitest and zod (the only runtime dependency). Froze the zod contracts and canonical sha256 hashing. Local git only.
- **2026-11-08 Phases 1–7 (offline).** Probe, snapshot, pure score and vows, SERV citation validation with one retry and a degraded fallback, Dolphin hash cache, receipts, ledger, drift rules.
- **2026-11-08 Local verification.** Added `npm run accept` under a no-network preload, plus contract and adversarial tests.
- **2026-11-08 Phases 3b–3f.** Installed surf with the checksum-verified installer. Recorded 12 real x402 v2 402s. Found billing is per call, not per payee. E v2 (payer concentration). Fixed the multi-chain 402 parser. Wired SERV and Dolphin live.
- **2026-11-09 Phase 3g–3j.** Paid audit gate, fixture guard (accept G11), staged census runner, parallel SERV ∥ Dolphin, pricing v2.
- **2026-11-09 Phase 3k.** Uniform 90-day census: 800 of 1,923 Base payees. Killed calls bisected, never re-sent.
- **2026-11-09 Phase 3l.** V6 null-payee vow at probe time, with in-repo keccak-256 and EIP-55. cleave.fi BLOCKed. 23 cluster funders labelled. Vow set frozen at six.
- **2026-11-09 Phase 3m–3n.** Identity v3 (corroboration by host, path, catalog or label). Adversarial lab with expectations committed before each run.
- **2026-11-09 Phase 3b-fix.** Dolphin became optional enrichment (12 s, one retry, `enrichment: incomplete`). V5 now REVIEWs an uncorroborated claim at any age and BLOCKs a contradicted one. Lab 9/9.
- **2026-11-09 Phase 3c–3e.** Static index page, an API with a real x402 v2 402 and dry-run settlement, and `npm run localhost-check` (10/10). The no-network preload now allows loopback, after phase3d had been committed with accept red.
- **2026-11-09 Phase 3f.** This README, LICENSE, `.nvmrc`, and a fresh-clone test.
- **2026-11-09 Phase 3g.** `localhost-check` forces live mode for its own server, whatever `.env` says. Fresh clone: test 219/219, accept 11/11, localhost-check 10/10 with keys (8/10 keyless, failing closed). Local bundle refreshed. No remote.
- **2026-11-09 Phase 3h.** The ALLOW composition audit found examination penalised: 63 examined-but-uncorroborated payees had 0 ALLOWs, and all live lab ALLOWs had `enrichment: incomplete`. Identity neutrality: an uncorroborated claim is identical to no claim, and V5 fires only on contradiction. Lab 8/9 (B4 recorded as a FAILURE). `localhost-check` defaults to fixture mode (zero keys, loopback only); `-- --live` for real providers.
- **2026-11-10 Phase 3i.** The frontend: three static pages in the logo's black, white and red (`/`, `/check?url=`, `/receipt/:id`), with no JavaScript and a CSP that forbids it. The free check page reuses its own probe for the null-payee gate and never calls a model. 229 tests; localhost-check 10/10 in fixture and live mode.
- **2026-11-10 Phase 3j.** The identity vow's only live BLOCK was a false positive: the wallet's label was a person's handle, not an organisation. Now only a label that names the wallet's operator can contradict a claim or stand in as a seller's name (`operatorName` in `src/core/identity.ts`), and a label naming a person is never printed. That payee moves BLOCK to REVIEW. Added the guide and the legal page (`docs/GUIDE.md`, `docs/LEGAL.md`), shown on the site at `/docs` and `/legal`. 248 tests.
- **2026-11-10 Phase 3k.** Receipts quoted every seller name as "surf label: …", even names taken from the seller's own catalog listing. Identity evidence now says where the name came from: `catalog listing name`, `surf label` or `claimed name`. Saved SERV replies are keyed by the evidence they were shown, so changed evidence re-asks the model instead of failing validation. One live SERV call re-recorded the fixture reply; the old recording stays in `fixtures/recorded/serv` unused, since raw fixtures are never overwritten. 250 tests.
