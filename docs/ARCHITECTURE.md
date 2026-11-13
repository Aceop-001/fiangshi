# Fiangshi architecture

This page explains how Fiangshi is built, so an integrator or auditor can trust it. It covers every component, every outside service it talks to, where data is kept, and what happens when each part fails. Every threshold below is copied from the source file named next to it. If this page and the code disagree, the code is right, and that is a bug in this page.

## The map

Figure: the map (animated on the site at /architecture).

In words: an AI tool (through MCP or HTTP) or a person (on the site) asks about a paid URL. Inside the Fiangshi server the request goes through eight steps: probe, null-payee gate, signals, score, model advice, six rules, decide and receipt. The seller, Surf, SERV, Dolphin and the ledger are each used by one step. The verdict, its evidence and a receipt id go back, and the agent's own wallet pays, or does not.

## See it working

The pictures on this page are working models: they move through the same steps the code takes. On the site at `/architecture` they are animated; in the repository the text describes them.

Figure: one check, live (animated on the site at /architecture).

Figure: who talks to whom (animated on the site at /architecture).

## What each step does

### 1. Probe

`src/adapters/probe.ts` sends one GET with no payment header and reads the HTTP 402 answer: the headers and the JSON body. It accepts x402 v1 and v2 shapes. It checks each payment option on its own, so one malformed option cannot hide a valid Base option. The terms are hashed as canonical JSON (sorted keys, `src/core/canonical.ts`), giving `terms_hash`. A probe that times out, returns something other than 402, or has no parseable Base option gives no verdict (`probe failed`), never ALLOW.

### 2. Null-payee gate (rule I, `null_payee`)

`src/core/v6.ts` runs before anything is spent. It blocks when the `payTo` address is:

- the zero address, in any spelling;
- a known burn address (`BURN_SINKS`);
- the payment token's own contract (paying a token contract burns the money);
- a mixed-case address that fails its EIP-55 checksum (keccak-256 is implemented in the file, with no dependency).

A blocked endpoint costs $0.00. No data call or model call is made, and a receipt is still sealed, so the BLOCK can be verified later.

### 3. Signals: where the facts come from

| source | when | cost | file |
|---|---|---|---|
| census | the payee is one of the 800 Base payees measured on 9 Nov (90-day window) | 0 credits at request time | `src/census.ts`, `fixtures/audit/` |
| cold check | a Base payee not in the census, on the paid route | 2 Surf SQL calls (8 credits), then cached 72 h | `src/cold.ts`, `src/cold-surf.ts` |
| funder labels | exchange, relayer, mixer, or unknown | measured once, committed | `fixtures/funders.json`, census checkpoints |

The signals are: wallet age, transaction count, first funder, how many other catalog sellers share that funder (`funder_fanout`), distinct payers, repeat payers, total received, the top payer's share, dormancy and identity claims. Each one carries a quoted line of evidence. A value that is negative, not a number, in the future, or self-funding is turned into "missing" (`sanitize` in `src/core/score.ts`), and a missing value triggers rule VI (silence), which gives REVIEW. A data error never gives BLOCK.

### 4. Score

`src/core/score.ts`. Each component is in [0, 1]. A missing optional component (identity) has its weight removed and the rest re-scaled, so having no claim is never a penalty.

| part | weight | how it is computed |
|---|---|---|
| M maturity | 25 | half log-scaled age (capped at the window), half log-scaled transaction count (cap 1,000) |
| P provenance | 20 | exchange funder 1.0 · fresh funder or relayer 0.6 · funder shared with other sellers 0.2 · mixer 0 |
| R revenue | 20 | 0.6 × log-scaled distinct payers (cap 100) + 0.4 × log-scaled repeat payers (cap 50) |
| I identity | 15 | no claim or unconfirmed claim: weight removed · one independent source 0.5 · two or more 0.75 |
| E exposure | 10 | breadth `min(1, log10(payers+1)/2)` × concentration `1 − max(0, top_share − 0.30)/0.70` |
| C corroboration | 10 | share of evidence fields that have a quote |

Bands from the score: 80 or more is ALLOW, 50 to 79 is REVIEW, under 50 is BLOCK.

### 5. Model advice

Two models run in parallel and neither can decide alone.

- **SERV Reasoning** (`src/adapters/serv.ts`) gets the signals and their evidence and must answer in strict JSON (`response_format` json_schema). The answer is checked by `validateModelOutput` in `src/core/decide.ts`: each cited signal must exist, and each quote must be an exact substring of the stored evidence. If the check fails, it is retried once with stricter instructions. If it fails again, the verdict is marked `degraded` and capped at REVIEW. A model BLOCK is capped at REVIEW too, because a model is not a machine-checkable reason.
- **Dolphin** (`src/adapters/dolphin.ts`) turns the seller's own prose into typed identity fields (organisation, product). It has no say on the verdict. It has 12 s per try and one retry; if it times out, the receipt says `enrichment: incomplete` and the band is not changed.

Model replies are cached by a hash of the exact evidence they saw, so the same evidence never pays twice, and changed evidence asks again.

### 6. The six rules (vows)

`src/core/vows.ts`. They run after the model and can only lower the band. When several fire, the most severe one is reported; ties go to the order below.

| # | rule | fires when | band |
|---|---|---|---|
| I | `null_payee` | payTo is zero, a burn address, the token contract, or fails EIP-55 (also run at probe time) | BLOCK |
| II | `age` | wallet age under 48 h (`AGE_MIN_H`) | BLOCK |
| III | `kinship` | first funder shared with 3 to 20 other catalog payees (`KINSHIP_MIN`, `KINSHIP_REVIEW_AT`), not an exchange or relayer | BLOCK |
| III | `kinship` | the same, with 21 or more and the funder unlabelled: flag `kinship_suspected_exchange` | REVIEW |
| IV | `history` | no distinct payers and price above $0.50 (`HISTORY_PRICE_USD`) | REVIEW |
| V | `identity` | a claimed name is contradicted by a label naming the wallet's operator | BLOCK |
| VI | `silence` | any required signal is missing | REVIEW |

### Band caps (not vows)

`src/core/cap.ts`. A band cap lowers a verdict because of Fiangshi's own evidence, not because of anything the counterparty did. That is why it is not a vow: it never asserts that a counterparty is unsafe, and it never produces BLOCK. It runs after the vows and the model, keeps the score unchanged, and is reported as `band_cap` with `verdict_confidence: "degraded"`.

| cap | applies when | effect |
|---|---|---|
| `data_stale` | the record's own data is older than `FIANGSHI_STALE_HOURS` (72) | ALLOW becomes REVIEW; REVIEW and BLOCK are unchanged |

Freshness belongs to each record: every payee carries `as_of`, the moment its data was collected, and its age is measured from that, never from the time the census run finished.

Policy versions: `2026-11-09.4` (rules v4, no caps; every receipt without a `policy_version`, including all census receipts) and `2026-11-13.5` (v5, with the stale cap). New receipts record `policy_version`, `as_of`, any `band_cap`, and `band_basis` (the score, model, vow and cap bands). `GET /v1/verify` re-derives the band under the version the receipt was issued with: a v4 receipt keeps its original band even when today's answer for the same payee is capped.

### 7. Decide

`src/core/decide.ts`: final band = the lowest of the score band, the model band and the deciding rule's band. ALLOW needs all three to agree. The model can only lower the band, never raise it.

Figure: lowest band wins (animated on the site at /architecture).

### 8. Receipt and ledger

`src/core/receipt.ts` writes a receipt with: payee, url, terms_hash, price, band, score, vow_fired, evidence quotes, model verdict and degraded flag, snapshot_id, checked_at, `chain: "eip155:8453"`, `prev_hash`, `receipt_hash` and settlement. `receipt_hash` is the sha256 of the canonical JSON of every other field, and `prev_hash` links it to the receipt before it in `data/ledger.jsonl`. Changing any field breaks `GET /v1/verify`.

The live ledger's chain is continuous only within one **epoch**. An epoch starts whenever the ledger starts empty: the first run, or a redeploy on hosting whose disk does not survive (the public API runs on such hosting). Every live receipt carries its epoch's `chain_id`, covered by the hash. `GET /v1/verify` reports the epoch and its start time, and says when a receipt comes from an epoch this server no longer holds: the receipt is still intact, but its link to its neighbours can only be checked against the epoch that issued it. Census receipts are rebuilt identically from committed data on every start, so their chain never resets.

Figure: the receipt chain (animated on the site at /architecture).

Receipts are tamper-evident through the hash chain. They are **not** signed with a private key: Fiangshi holds no keys at all. Anyone can recompute a hash.

`src/ledger/drift.ts` flags a payee whose band crosses 50 or 80, whose payee address rotates, whose funder changes, whose price moves more than 10% (`PRICE_DRIFT`), or which wakes up after 60 or more dormant days (`DORMANCY_DAYS`). A verdict older than 72 h (`FIANGSHI_POLICY_TTL_HOURS`) is stale and must be checked again.

## Outside services

| service | used for | how | when it fails |
|---|---|---|---|
| the seller's endpoint | the 402 terms | one unpaid GET, 15 s limit | no verdict (`probe failed`) |
| Surf (`surf` CLI, `agent.base_transfers`) | on-chain facts for the census and cold checks | SQL over Base transfers, always filtered on `block_date`, batched, budget-guarded | REVIEW with `surf_error`, `budget_guard` or `unavailable` on the receipt |
| SERV Reasoning (`SERV_BASE_URL`/chat/completions) | advice with quoted evidence | strict JSON schema, 15 s limit, one stricter retry | `degraded`, capped at REVIEW |
| Dolphin (`DOLPHIN_BASE_URL`) | identity fields from prose | 12 s, one retry on timeout | `enrichment: incomplete`, band unchanged |
| x402 payer (your agent) | pays Fiangshi for the paid routes | `X-PAYMENT` header, checked by `src/adapters/x402.ts` | 402 again; settlement in this build is `dry-run` |

The HTTP server itself never calls Surf for the census: the census is built from committed files at startup. Only the cold check calls Surf at request time, and only on the paid route.

## Storage

| path | what | committed |
|---|---|---|
| `fixtures/` | recorded 402s, census data, funder labels, model replies, lab cases | yes |
| `data/ledger.jsonl` | live receipts, one JSON per line, hash-chained | no (`data/` is ignored) |
| `data/cold-cache.json` | cold-check signals, 72 h | no |
| `data/numbers.json` | every headline number, written by `scripts/numbers.ts` | no (rebuilt) |
| `artifacts/*.md` | audit, matrix, costs, sensitivity, win-rate, history | yes |

There is no database server. There are no accounts and no user records.

## Security and trust model

- **No custody.** Fiangshi never holds funds, signs transactions, or sends them. It has no private key. The paid routes receive payment to an address the operator sets (`FIANGSHI_PAYTO`), which must itself pass rule I.
- **Fail closed.** Missing data, a timeout, a schema violation, a model failure or a budget refusal gives REVIEW. Nothing defaults to ALLOW. BLOCK always names a rule and quotes evidence.
- **Rules over model.** A model answer is advice. It can lower a verdict, never raise it, and its quotes are checked word for word against stored evidence, so it cannot invent facts.
- **No scripts on the site.** Every HTML page is sent with `Content-Security-Policy: default-src 'none'`. The site uses one functional cookie only to remember that the first-visit tour was closed (see the Legal page). There is no tracking.
- **Input handling.** Only `http(s)` URLs up to 2,000 characters are probed. Every request handler is wrapped, so one failing request cannot stop the server. Markdown pages escape all raw HTML.
- **Reproducible numbers.** Every number in the documents comes from a committed script. `npx tsx scripts/numbers.ts --check` (accept gate G12) fails the build if a document disagrees.

## Budgets and limits

| limit | value | where |
|---|---|---|
| Surf calls per run | 60 (`FIANGSHI_MAX_SURF_CALLS`) | budget guard |
| Surf floor before a cold check | 32 credits (`FIANGSHI_SURF_FLOOR`) | `src/cold.ts` |
| Surf addresses per label call | 20 at most | `scripts/surf/labels.ts` |
| SERV calls / Dolphin calls | 100 / 200 per process | budget guard |
| model timeout | 15 s (`FIANGSHI_MODEL_TIMEOUT_MS`) | `src/adapters/serv.ts` |
| verdict lifetime | 72 h | `FIANGSHI_POLICY_TTL_HOURS` |
| prices | cached check $0.05 · cold check $0.15 · payee record $0.02 | `.env.example` |

## Configuration

| variable | meaning |
|---|---|
| `SERV_REASONING_API_KEY`, `SERV_BASE_URL`, `SERV_MODEL` | SERV Reasoning access |
| `DOLPHIN_API_KEY`, `DOLPHIN_BASE_URL`, `DOLPHIN_MODEL` | Dolphin access |
| `SURF_API_KEY`, `SURF_BIN` | Surf CLI (scripts and cold checks) |
| `FIANGSHI_PAYTO` | your Base wallet for payments to the paid routes; paid routes are off without it |
| `FIANGSHI_REPLAY=1` | fixture mode: recorded replies through the real code, no keys, no network |
| `FIANGSHI_OFFLINE`, `MOCK_MODELS` | mock models for tests |
| `FIANGSHI_URL` | where the MCP server finds the HTTP server (default `http://127.0.0.1:8787`) |
| `HOST`, `PORT` | server bind (default 127.0.0.1:8787) |
| `FIANGSHI_DATA_DIR` | where the ledger and caches go (default `data`) |

The full list, with defaults, is in `.env.example`.

## Latency and timeouts

Measured from outside against the public API by `npx tsx scripts/latency-live.ts --write` (details and the full timeout contract in `artifacts/latency-live.md`): a census payee answers in p50 469 ms, p95 508 ms; the null-payee gate in p50 279 ms, p95 360 ms; a URL that is not an x402 endpoint in p50 270 ms, p95 315 ms (20 samples each, 13 Nov 2026). A cold check has one live sample, 10.8 s. The first request after the free-tier server sleeps can take up to about a minute.

Every stage has a limit, and every limit ends in REVIEW or no verdict, never ALLOW: the unpaid probe 15 s (`no_verdict`), SERV 15 s with one stricter retry (`degraded`, REVIEW), Dolphin 12 s with one retry (band unchanged), each Surf call 25 s with the shipped settings (`surf_error`, REVIEW).

## Failure modes

| what goes wrong | what you get | why |
|---|---|---|
| seller endpoint down or not a 402 | no verdict, `probe failed` | nothing to judge |
| payTo is a dead end | BLOCK, $0.00 | rule I at probe time |
| payee not in census, free route | `no_record` | the free route never spends credits |
| payee not on Base | REVIEW, `network_not_base` | the data source covers Base only |
| Surf budget below the floor | REVIEW, `budget_guard` | never overspend |
| Surf error or timeout | REVIEW, `surf_error` | fail closed |
| a required signal missing | REVIEW, rule VI | fail closed |
| SERV invalid twice | REVIEW, `degraded: true` | the model cannot be trusted this time |
| SERV says BLOCK, rules say nothing | REVIEW | a model alone is not a machine-checkable reason |
| SERV says ALLOW, a rule says BLOCK | BLOCK | rules override the model |
| Dolphin times out | band unchanged, `enrichment: incomplete` | identity is optional |
| receipt edited | `valid: false` on verify | hash mismatch |

## What it does not do

- It does not pay, sign, hold or move money.
- It does not cover chains other than Base (`eip155:8453`).
- It does not promise a seller is honest. ALLOW means no rule fired and the evidence is strong today. It is advice for the next 72 hours.
- It does not settle real payments in this build: settlement is `dry-run`.
- It does not track visitors.
