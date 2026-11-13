<div align="center">

# Fiangshi

**Pre-payment counterparty checks for x402 agent payments.**

[**fiangshi.xyz**](https://fiangshi.xyz) · [Docs](https://fiangshi.xyz/docs) · [Architecture](https://fiangshi.xyz/architecture) · [Test report](https://fiangshi.xyz/report) · [Connect your agent](https://fiangshi.xyz/connect)

![tests](https://img.shields.io/badge/tests-346%20passing-2b2b2b) ![accept](https://img.shields.io/badge/accept%20gates-16%2F16-2b2b2b) ![chain](https://img.shields.io/badge/chain-Base-2b2b2b) ![license](https://img.shields.io/badge/license-MIT-2b2b2b)

*The model advises, the vows decide.*

</div>

---

AI agents now pay for API calls on their own, using the [x402](https://www.x402.org/) protocol: a server answers `402 Payment Required`, names a price and a wallet, and the agent pays in USDC. Nothing in that exchange tells the agent **who it is paying**.

Fiangshi answers that question before the money moves. Given a paid endpoint, it probes the `402` without paying, identifies the wallet that would receive the funds, scores it against on-chain evidence, lets a reasoning model advise, and applies six deterministic rules that the model cannot override. The result is one of three verdicts, with quoted evidence and a tamper-evident receipt:

| verdict | meaning |
|---|---|
| **ALLOW** | No rule fired and the evidence is strong. The agent may pay. |
| **REVIEW** | Something is missing or unclear. A human decides, or the amount is capped. |
| **BLOCK** | A rule fired. The agent should not pay. The rule and its evidence are quoted. |

Fiangshi is advisory only. It never holds funds, signs transactions or moves money, and it fails closed: missing data, a timeout or a model failure produces REVIEW, never ALLOW.

## Highlights

- **Fail-closed by design.** Six fixed rules run after the model and can only lower a verdict. A model alone can never produce ALLOW or BLOCK.
- **Free protection against dead-end wallets.** A `payTo` that is the zero address, a burn address, the token contract or an invalid checksum is blocked at probe time, for $0.00, before any data or model call.
- **Evidence, not opinion.** Every model quote is checked word for word against stored evidence, and every verdict is sealed in a sha256 hash-chained receipt that anyone can re-verify.
- **Measured on real sellers.** A census of every Base payee in the x402 Bazaar catalog, 1,923 of 1,923 Base payees (90-day window, refreshed 13 Nov, each record with its own collection time): 127 ALLOW · 1,244 REVIEW · 552 BLOCK. Every number in this repository is reproduced by a committed script.
- **Built for agents.** An MCP server, a CLI whose exit code is the verdict, a zero-dependency Python client, and an agent skill for Claude Code, Codex, Grok CLI and Hermes.

## Try it

**On the website.** Paste any x402 paid endpoint into the check box at [fiangshi.xyz](https://fiangshi.xyz). The check runs live on the Fiangshi API at [api.fiangshi.xyz](https://api.fiangshi.xyz/health): one unpaid probe, the null-payee rule and the census verdict, free. The site also shows the full census, every payee with its sealed receipt, the six rules and the documentation.

**From any HTTP client, against the live API.**

```bash
curl "https://api.fiangshi.xyz/v1/preview?url=https%3A%2F%2Fapi.cleave.fi%2Fx402%2Fgas"
```

The paid check is live too. Without a payment it answers `402 Payment Required` with x402 terms: $0.05 in USDC on Base, paid to the operator's wallet. Send an `X-PAYMENT` header for those terms and it returns the full verdict, with the SERV model's advice and a sealed receipt. Settlement is dry-run: the header is checked, nothing is charged.

```bash
curl -i "https://api.fiangshi.xyz/v1/check?url=https%3A%2F%2Fapi.bitrefill.com%2Fx402%2Fgift-cards%2Fsearch"
```

The free-tier server sleeps when idle; the first request after a quiet period can take up to a minute.

**Self-hosted, from an agent or a terminal.**

```bash
git clone https://github.com/Aceop-001/fiangshi.git && cd fiangshi
npm ci && npm run build
npm run dev                                   # site + API on http://127.0.0.1:8787
npm run --silent fiangshi -- preview "https://api.cleave.fi/x402/gas"
# BLOCK  api.cleave.fi/x402/gas · rule null_payee · the zero address · exit code 20
```

| integration | how | guide |
|---|---|---|
| Claude Code, Claude Desktop, Codex, Grok CLI, Hermes, Cursor, VS Code, Gemini CLI | MCP server (`src/mcp/server.ts`), four tools | [Connect](https://fiangshi.xyz/connect) |
| Shell scripts and agents that run commands | `fiangshi` CLI, verdict as exit code: 0 ALLOW · 10 REVIEW · 20 BLOCK | [CLI and skill](https://fiangshi.xyz/cli) |
| Python agents (LangChain, CrewAI, AutoGen, OpenAI / xAI / DeepSeek SDKs) | `clients/python/fiangshi_client.py`, standard library only | [Python client](https://fiangshi.xyz/cli#python-client) |
| Any HTTP client | `GET /v1/preview?url=` (free), `GET /v1/check?url=` (x402-paid) | [Guide](https://fiangshi.xyz/guide#routes) |

## How it works

```
probe the 402  →  null-payee gate  →  wallet signals  →  score  →  model advice  →  six rules  →  lowest band wins  →  sealed receipt
```

1. **Probe.** One unpaid request; parse the `402` terms (price, asset, network, `payTo`).
2. **Gate.** Dead-end payment addresses are blocked immediately, at no cost.
3. **Signals.** Wallet age, first funder, payers, repeat payers and concentration, from the census or a live on-chain lookup via Surf.
4. **Score.** `25·Maturity + 20·Provenance + 20·Revenue + 15·Identity + 10·Exposure + 10·Corroboration`, 0 to 100.
5. **Advice.** SERV Reasoning returns strict JSON; every quote must match stored evidence or the answer is discarded.
6. **Rules.** `null_payee`, `age`, `kinship`, `history`, `identity`, `silence`. They only lower the verdict.
7. **Receipt.** Canonical JSON, sha256, chained to the previous receipt.

The [architecture page](https://fiangshi.xyz/architecture) shows this as an animated map, with every outside service, the trust model and the failure modes.

## Quality

| check | result |
|---|---|
| unit and integration tests | 333 passing (`npm test`) |
| offline acceptance gates, network blocked | 15 / 15 (`npm run accept`) |
| end to end on a live local server | 10 / 10 (`npm run localhost-check`) |
| adversarial lab, expectations committed before each run | 8 pass, 1 superseded by a documented rule change |
| numbers in documents vs. the data | enforced by gate G12 (`npx tsx scripts/numbers.ts --check`) |

The [test report](https://fiangshi.xyz/report) lists every failure found while building Fiangshi, with its cause, fix and proof, and what is still open.

## Status

Built for SERV Hackathon 02 (November 2026). Settlement on the paid routes is **dry-run**: payment headers are validated for structure and nothing is settled. Coverage is Base (`eip155:8453`) only. See [Limits](#limits).

---

## Developer quickstart

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
- `npm run build && npm start` serves the compiled app on `0.0.0.0:$PORT` for production. `npm run export` builds the static edition published at fiangshi.xyz.

`localhost-check` starts its own server on 8787, so stop `npm run dev` first, or set `FIANGSHI_CHECK_PORT`.

## Technical reference

### The six vows (frozen)

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
| census coverage | **1,923 of 1,923 Base payees, 90-day window** (100%; refreshed 13 Nov for 620 credits, each record with its own `as_of`) | `npx tsx scripts/audit.ts report --sample fixtures/audit/sample-census-r2.json --days 90` → `artifacts/audit.md` |
| bands | **127 ALLOW · 1,244 REVIEW · 552 BLOCK** (policy `2026-11-13.5`; the 9 Nov census of 800 was 49 / 539 / 212 under v4) | `data/numbers.json` (`npx tsx scripts/numbers.ts`); also `GET /v1/index.json` |
| ALLOW composition | 31 no claim · 10 claim with 0 sources · 76 with 1 source · 10 with 2+ | `npx tsx scripts/allow-composition.ts` |
| kinship | 743 payees share a first funder with 3+ others. 281 BLOCK; 462 REVIEW as suspected exchanges (8 clusters of 22 or more payees, the largest 102). 47 of the 49 funders have no Surf label; 2 have one that is not an exchange or relayer | `npx tsx scripts/sensitivity.ts` → `artifacts/sensitivity.md` |
| probe check | 123 live 402s parsed, **0 payee mismatches** (live `payTo` = catalog) | `audit.ts probe` → `fixtures/audit/probes.jsonl` |
| adversarial lab | **8 / 9 pass, 1 superseded.** 3 / 3 real controls ALLOW. B4 was written under rules v3; identity neutrality (rules v4) makes its outcome correct, documented in `fixtures/lab/supersessions.json` | `scripts/build-lab.ts` + `scripts/matrix.ts` → `artifacts/lab.md` |
| tests | 346 passing; accept 16 / 16 (G12 numbers consistency, G13 cold cache, G14 kinship thresholds, G15 sensitivity, G16 no stale ALLOW) | `npm test`, `npm run accept` |
| localhost end to end | 10 / 10 PASS in fixture mode (no keys) and in live mode | `npm run localhost-check [-- --live]` |

**Win rate:** lab 9/9 (1 superseded) · false-block rate at most 66% · BaseScan first seen 0 s, funder match, transfers +3.2% · 95.6% of the census verdictable (`npx tsx scripts/winrate.ts`). Details: `artifacts/winrate.md`.

These are the only band counts the repo states; every page (README, `artifacts/audit.md`, `artifacts/capability.md`, the index) shows the same split. Earlier rule sets live in git history.

## Latency and price

| | latency | price |
|---|---|---|
| V6 BLOCK (null payee) | one unpaid probe, no model call | **$0.00** |
| cached check (payee in the census) | **warm p50 251 ms** in the latest live run (`artifacts/demo-stats.json`, 2026-11-11, 3 calls). The live unpaid probe dominates and depends on the seller's own response time: the seven runs committed so far ranged from 251 to 935 ms (`git log -p artifacts/demo-stats.json`) | **$0.05** (`FIANGSHI_PRICE_CHECK`) |
| first check of a census payee (no cached model reply) | up to ~25 s when Dolphin times out twice (12 s + one retry) | **$0.05** |
| cold check (payee not in the census) | **10.8 s** in the one live run: two Surf SQL calls for that address, then SERV and Dolphin (`artifacts/cold-live.md`). Cached for 72 h; the repeat was $0.05, 0 Surf calls, 237 ms | **$0.15** (`FIANGSHI_PRICE_CHECK_COLD`). Cost $0.0499 measured (8 credits + models), margin 67% |
| payee record `/v1/payee/:addr` | census lookup | **$0.02** (`FIANGSHI_PRICE_PAYEE`) |

Cost basis (`npx tsx scripts/pricing.ts`, details in `artifacts/costs.md`): a cached check costs $0.0019 in model calls against a $0.05 price (96% margin). A cold check costs $0.0499 measured (2 SQL calls at 4 credits by balance, plus models) against $0.15 (67%), or $0.0619 if Surf's `meta.credits_used` (5 per call) is taken at face value (59%).

## Website and API

The same process serves the website and the API. Pages contain no JavaScript and load nothing from other sites; a Content-Security-Policy of `default-src 'none'` enforces it (`tests/api.test.ts`). The site is available in English, Chinese, Japanese and Korean (`/zh`, `/ja`, `/ko`).

| page | what it shows |
|---|---|
| `/` | The census (band counts, score histogram), case files, the six rules with how often each fired, shared funders, and all 1,923 payees with their receipts. |
| `/check?url=` | A free probe: one unpaid GET, the null-payee gate and the census band. Never calls a model. (Live server only.) |
| `/receipt/:id` | A receipt as a paper slip, with the result of recomputing its hash and chain link. |
| `/docs` | Documentation home: [Guide](docs/GUIDE.md), [Connect](docs/CONNECT.md), [CLI and skill](docs/CLI.md), [Architecture](docs/ARCHITECTURE.md), [Test report](docs/REPORT.md), [Legal](docs/LEGAL.md). |

| route | price | notes |
|---|---|---|
| `GET /v1/preview?url=` | free | probe, null-payee gate and census answer as JSON; what the MCP tool `fiangshi_preview` calls |
| `GET /v1/check?url=` | $0.05 cached, $0.15 cold | null payees answer BLOCK free; otherwise a real x402 v2 `402` until `X-PAYMENT` is sent |
| `GET /v1/payee/:addr` | $0.02 | x402 v2 `402`, then the census record |
| `GET /v1/index.json` | free | every census payee with band, score and receipt id |
| `GET /v1/receipt/:id`, `GET /v1/verify?id=` or `?receipt=` | free | `receipt` = base64url receipt JSON; one changed byte gives `valid: false` |
| `GET /v1/badge/:addr.svg`, `GET /health` | free | badge coloured by band; server status |

Settlement is **dry-run**. `X-PAYMENT` is checked for structure only; the signature is not verified and no transaction hash is ever invented. Paid routes stay disabled until `FIANGSHI_PAYTO` (your wallet, which must pass the null-payee rule) is set.

## Limits

- **90-day window.** Wallet age is a lower bound: first seen within 90 days.
- **Unnamed funders.** Surf names few funders. Kinship threshold v2 sends clusters of 21+ payees on one unnamed funder to REVIEW (`kinship_suspected_exchange`) instead of BLOCK; smaller clusters still BLOCK. `artifacts/sensitivity.md` shows the effect of each policy.
- **No live payee under 48 h.** 0 of 1,923 census payees are that young, so the age vow is tested on fixtures but has not fired live.
- **Label coverage is thin.** 81 of 1,907 addresses got a Surf label row (4.2%); 42 name an entity or type. Missing or uncorroborated identity is scored as neutral (weight excluded), not as trust and not as a penalty.
- Dolphin identity extraction is **optional enrichment**. A timeout is stamped `enrichment: incomplete` on the receipt and never caps the verdict.
- Receipts are hash-chained (`sha256` + `prev_hash`), **not signed**. The live ledger's chain is continuous only within one epoch (`chain_id` on every live receipt); on the public API, whose disk does not survive a redeploy, each deploy starts a new epoch. Older receipts still verify on their own. Census receipts never reset.
- **First funder inside the window.** For a wallet older than the 90-day window, the first sender inside the window stands in for its funder. As the window moves, that sender can change: between 9 and 13 Nov it changed for 164 of the 800 original payees, and kinship began to fire on several well-known sellers (Nansen, Glassnode, TBS) through shared relayer-like senders Surf cannot name. `scripts/winrate.ts` bounds the effect: at most 436 of the 552 BLOCKs (79%) would clear if every unnamed shared funder were an exchange (policy C in `artifacts/sensitivity.md`).
- **Census data ages.** The census was refreshed on 13 Nov 2026 (one record, the zero address, is from 9 Nov). Every free answer states `data_as_of`, `data_age_hours` and `stale` (past 72 hours), and lists in `unknowns` what it could not check, such as an unlabelled funder.

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
- **2026-11-11 Final pass, phase A.** Kinship threshold v2: an unlabelled funder shared with 21+ other catalog payees gives REVIEW with the flag `kinship_suspected_exchange`; 3 to 20 still BLOCK (lab B2 sits at 20). It never creates a BLOCK. Census 49 / 539 / 212; BLOCK moved 25.9%, over the 15% limit first set, accepted by the owner. `artifacts/sensitivity.md` compares three policies. Lab 8 pass, 1 superseded (B4, documented in `fixtures/lab/supersessions.json`).
- **2026-11-11 Final pass, phase B.** Asked Surf again about all 19 funders behind a kinship firing (one `wallet-labels-batch` call, 4 credits by balance, 1,060 → 1,056). 3 came back with no name or type, 16 returned nothing: 0 exchange, 0 relayer, 0 individual, 19 unnamed. 123 kinship BLOCKs and 120 suspected-exchange REVIEWs stand.
- **2026-11-11 Final pass, phase C.** Cold check wired (`src/cold.ts`): a Base payee outside the census is fetched live with two Surf SQL calls (inbound, outbound; 90 days), behind the budget guard and a 32-credit floor checked before spending, then scored, adjudicated and sealed. $0.15. Cached 72 h, so the repeat is $0.05 with zero Surf calls (tested). Fail closed: `budget_guard`, `surf_error`, `network_not_base` or `unavailable` give REVIEW with the reason on the receipt. One live run: 8 credits, 10.8 s, ALLOW 86.36 (`artifacts/cold-live.md`).
- **2026-11-11 Final pass, phase D.** `scripts/winrate.ts` → `artifacts/winrate.md`: lab 9/9 (8 pass, 1 superseded), per-vow precision and recall, a false-block upper bound (at most 66% of BLOCKs, if every unnamed funder were an exchange), BaseScan agreement on one hand-checked payee (now a fixture), label coverage before and after, and verdictable coverage (95.6%).
- **2026-11-11 Final pass, phase E.** `scripts/numbers.ts` → `data/numbers.json` is the one definition of bands, census size, credit spend (census billed 252 by balance, `fixtures/audit/balances.json`), cost per payee, latency and label coverage; `--check` fails on any document that disagrees, run as accept gate G12. New gates G13 (cold cache), G14 (kinship thresholds), G15 (sensitivity = numbers): accept 15/15. Every receipt and payee now carries `chain: "eip155:8453"`.
- **2026-11-11 Final pass, phase F.** All gates green: 263 tests, accept 15/15, localhost-check 10/10 in fixture and live mode. Fresh clone in /tmp with no keys: `npm ci`, `npm test` 263/263, `npm run accept` 15/15, `npm run localhost-check` 10/10. Progress report regenerated with print rules so no block is cut at a page foot. Final pass Surf spend: 12 credits (balance 1,060 → 1,048).
- **2026-11-11 The guardian.** The hero is now the "Guardian of Fiangshi" poster, a still image (`assets/guardian-poster.webp`, served by exact name only), and the wordmark is 菲昂诗. A CSS-only dragon animation was tried and removed at the owner's request.
- **2026-11-12 Guide and test report.** The poster is gone; the hero shows the clock mark again and the wordmark is FIANGSHI. `/guide` (formerly `/docs`, still served there) opens with seven real paid endpoints to try and one check walked through step by step; `tests/guide-examples.test.ts` checks every stated answer and fact against the census. New `/report` (`docs/REPORT.md`): every failure in the build, what fixed it, what is still open, plus the lab history and last measured status computed from committed files. 272 tests, accept 15/15.
- **2026-11-12 Languages.** The clock mark now carries the name in Chinese (菲昂诗); the top-bar wordmark stays FIANGSHI. A switcher in the bar (EN / 中文 / 日本語 / 한국어) serves the site under `/zh`, `/ja` and `/ko`, with no cookie and no script; links stay in the chosen language, while API links and the switcher do not. The interface, home page, check page and receipt page are translated (`src/i18n.ts`); verdict words, rule names and the three long documents stay in English, with a translated notice. Tests check every string has all three translations with matching placeholders, and that every string the pages use is in the dictionary. 283 tests.
- **2026-11-12 No clock.** The clock mark is removed from the home page and the receipt slip at the owner's request. The hero is the check panel alone, centred over the falling question marks. 283 tests, accept 15/15.
- **2026-11-13 Connect, architecture, tour.** An MCP server with no dependencies (`src/mcp/server.ts`, `npm run mcp`; tools `fiangshi_preview`, `fiangshi_check`, `fiangshi_payee`, `fiangshi_verify_receipt`; it never pays) and a free JSON twin of the check page, `GET /v1/preview?url=`. New pages `/architecture` (the pipeline map, every outside service, storage, trust model, failure modes) and `/connect` (setup for Claude Code, Claude Desktop, Codex, Grok CLI, Hermes, Cursor, VS Code, Gemini CLI, and function calling for xAI and DeepSeek). The test report now lists 18 failures with cause, fix and proof, plus per-commit test and gate counts (`scripts/history.ts`). A first-visit tour (CSS only), opened again from the Take the tour button beside the check panel; closing it sets the site's one functional cookie, disclosed on the Legal page. 301 tests, accept 15/15, localhost-check 10/10.
- **2026-11-13 Working models.** The cat ticket is gone; the tour opens from a plain Take the tour button. `/architecture` now has four animated figures (`src/arch-visuals.ts`, inline SVG with SMIL and CSS, no script, no image files): three real lab cases running through the eight steps, who Fiangshi talks to and where the money goes, the lowest band winning, and the receipt chain catching an edited receipt. Reduced motion shows a labelled still. 302 tests, accept 15/15.
- **2026-11-13 Live map.** The text-art map on `/architecture` is replaced by an animated map (figure 1): clients, the eight steps inside the server with the file for each, the services each step calls, the free BLOCK branch, and a dot that walks one request through it with a caption per step. The repository copy describes it in words. 302 tests.
- **2026-11-13 Docs, CLI and skill.** The tour button is removed (the first-visit tour stays, `/?tour=1` reopens it). The top bar has one Docs link: `/docs` is a documentation home, and every document (`/guide`, `/connect`, `/cli`, `/architecture`, `/report`, `/legal`) shares a sidebar grouped Get started / How it works / Policies, a breadcrumb and previous / next links (`src/docs-index.ts`). Agent CLI (`src/cli/agent.ts`, `bin: fiangshi`): `preview`, `payee`, `receipt`, `quote`, `skill install`, `mcp`, with `--json` and the verdict as exit code (0 ALLOW, 10 REVIEW, 20 BLOCK). Agent skill `skills/fiangshi/SKILL.md`, installable into Claude Code, Codex, Grok CLI and Hermes. 311 tests.
- **2026-11-13 Python client, production start.** `clients/python/fiangshi_client.py`: one file, standard library only, with `preview`, `payee`, `verify_receipt`, `quote`, OpenAI-style `tools()` / `call_tool()`, and a command line with the same exit codes; its tests run inside `npm test` when Python is present. `npm start` (after `npm run build`) serves the compiled app on `--host 0.0.0.0` and `PORT`. Fixed: ten scripts located the project folder from their own path, so the compiled server could not find the census; all now use the shared root, and a test guards it. Behind an HTTPS proxy, handed-out links use https and the tour cookie is Secure. 315 tests.
- **2026-11-13 Static edition on GitHub Pages.** `npm run export` runs the real server in static mode (`FIANGSHI_STATIC=1`), crawls every page in all four languages (home, docs, the 800 census receipts, `/v1/index.json`) and writes them to `site/` with `CNAME` and `404.html`; it fails if any page links to a missing page or a server-only route. In the static edition the check box shows the one-line CLI command instead of a form, try-it links open sealed receipts, and the tour is off. `.github/workflows/pages.yml` tests, exports and publishes on every push to `main`, at fiangshi.xyz. 319 tests.
- **2026-11-13 Public launch.** https://fiangshi.xyz is live on GitHub Pages with HTTPS. The README is rewritten for readers outside the hackathon (what Fiangshi does, how to try it, integrations, quality, status), and the repository has a homepage, description and topics. `render.yaml` describes the live API service for Render (`api.fiangshi.xyz`); when the repository variable `FIANGSHI_API_URL` is set, the static site's check box and try-it links send checks to that API, and its CSP allows that one origin for forms. 322 tests.
- **2026-11-13 Live checks.** The API runs on Render (`render.yaml`) at https://api.fiangshi.xyz (also https://fiangshi-api.onrender.com). The repository variable `FIANGSHI_API_URL` points the website's check box and try-it links at it, so a visitor can paste a paid endpoint on fiangshi.xyz and get a live verdict and receipt.
- **2026-11-13 External review fixes.** Acting on an outside review of the live service: (1) live receipts carry a `chain_id` epoch and `/v1/verify` states that continuity resets on redeploy instead of implying an unbroken history; (2) every free answer has one schema on every path (`vow_fired`, `vows_fired[]`, numeric `cost_usd`), guarded by a contract test, and `/v1/check` gained `vows_fired[]`; (4) a disabled paid route is no longer advertised as a link; (5) answers state `data_as_of`, `data_age_hours` and `stale`, and the home page shows the census age; (6) live p50/p95 and a timeout contract (`scripts/latency-live.ts`, `artifacts/latency-live.md`); and every answer lists `unknowns`, what Fiangshi could not check. The review's point 3 was checked against the data: no census payee fires age, history or identity, so those stay unit-tested only and are documented as such. 333 tests.
- **2026-11-13 Policy v5 (`2026-11-13.5`): per-record freshness and a stale cap.** Every census record carries its own `as_of`; age is measured from it, never from the run's timestamp. A band cap (not a vow, `src/core/cap.ts`) runs after the vows and the model: data older than `FIANGSHI_STALE_HOURS` (72) caps ALLOW at REVIEW, never raises a band, never touches the score, and is reported as `band_cap` with `verdict_confidence: "degraded"`. New receipts record `policy_version`, `as_of`, `band_cap` and `band_basis`; `/v1/verify` re-derives every band under the version the receipt was issued with, so the 800 census receipts (v4) keep their original bands. Published figures are evaluated at a committed reference time (`fixtures/audit/numbers-as-of.json`) so they stay reproducible. 344 tests.
- **2026-11-13 Census refresh.** All 1,923 Base payees re-collected from Surf (90-day window), each record with its own `as_of`, into new files (`sample-census-r2.json` and its checkpoint); the 9 Nov census and its 800 receipts are unchanged and still verify under v4. Spend 620 credits by balance (2,048 → 1,428, the cap): gate 4, payee SQL 312 in 68 calls with 0 refusals, labels 304 in 76 calls of 19. Bands 127 ALLOW · 1,244 REVIEW · 552 BLOCK. As the window moved, the first in-window sender changed for 164 of the 800 original payees and kinship began to fire on several known sellers; no rule changed (`artifacts/refresh.md`).
- **2026-11-13 Paid 402 with real terms.** `/v1/check` answers 402 with x402 v2 terms: exact, eip155:8453, USDC, 50000 atomic cached or 150000 cold, 60 s, `payTo` from `FIANGSHI_PAYTO` (V6-checked), plus the `payment-required` header. A paid answer carries `X-PAYMENT-RESPONSE` stating success false, no transaction, settlement dry-run. The preview reports `paid_check_status: "enabled: …"`.
- **2026-11-13 Figures under policy v5.** Reference time moved to 2026-11-13T12:00Z; numbers, sensitivity, win rate, audit report and the new `artifacts/refresh.md` are regenerated by script. Check pages show each payee's data age and collection time. New gate G16: no stale ALLOW in the published index at the reference time, just past the limit and long after. 345 tests, accept 16/16, localhost-check 10/10 (fixture mode replays the recorded 9 Nov moment).
- **2026-11-13 Paid route live.** With the operator wallet set on Render, `https://api.fiangshi.xyz/v1/check` answers 402 with Base USDC terms paying `0x0FdE…6007`; the guide now shows that captured response, and a test checks it matches the local terms, parses with our own parser and passes rule I. A structural test payment returns 200 with a sealed receipt and an `X-PAYMENT-RESPONSE` of settlement dry-run. Without model keys on the server the paid answer fails closed at REVIEW (`model_band: REVIEW`, degraded). 346 tests, accept 16/16.
- **2026-11-13 Model live, report updated.** With `SERV_REASONING_API_KEY`, `SERV_MODEL` and the Dolphin settings on Render, a test payment for Bitrefill answers ALLOW (SERV ALLOW, Dolphin complete, 3.6 s); before `SERV_MODEL` was set it failed closed at REVIEW. The test report adds F19–F22 (refresh false starts, window drift, tests tied to one census, the paid REVIEW) and the census stale date (16 Nov, 10:54 UTC).
