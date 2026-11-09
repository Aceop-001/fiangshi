# Surf capability report

Measured 2026-11-08 on the unauthenticated free tier (30 credits/day per IP), using surf 1.0.11. Every number below comes from a committed file:
- `fixtures/surf/smoke-2payees.json`, `fixtures/surf/smoke-12payees.json` and `fixtures/surf/labels-12payees.json` (raw responses)
- `artifacts/costs.md` (budget-guard ledger)
- `scripts/surf/payee-facts.ts` and `scripts/surf/labels.ts` (the queries)

## Score components

| component | obtainable | command + field | proxy if unavailable | est. credits / 100 payees |
|---|---|---|---|---|
| **M maturity** | **yes** | `onchain-sql` on `agent.base_transfers`: `min(first_inbound_at, first_outbound_at)` gives first_seen; `inbound_count + outbound_count` gives transfers | — | 10 (inbound + outbound query) |
| **P provenance** | **yes** | `payee-inbound.sql` `first_inbound_from`, then `wallet-labels-batch` `entity_type` (`cex`) | Unlabelled funder with ≥500 distinct outbound receivers in the window is treated as an exchange (extra `payee-outbound.sql` run over the funders) | 5 (funder fanout) + 2 (labels, ≤100 addresses per call) |
| **R revenue reality** | **yes** | `payee-inbound.sql` `distinct_inbound_senders`, `inbound_count`, `inbound_usd` | `repeat_payers` = `inbound_count − distinct_inbound_senders` until a repeat-sender count is added to the same query | 0 (same query as M) |
| I identity | partial | `wallet-labels-batch` `entity_name` and labels. Bitrefill and Bybit come back named; ENS names like `lasofinance.eth` come back as labels. Covered 6 of 23 addresses | Claims extracted by Dolphin from the Bazaar `description` / `serviceName`, checked against the label | 0 (shares the P labels call) |
| **E exposure (v2)** | **yes** | `payee-inbound.sql` `distinct_inbound_senders` + `top_payer_share` (largest sender's share of inbound USD, from `sumMap` by `from`) | — (v1's `top_token_share` is kept, informational only) | 0 (same query) |
| C corroboration | yes | Computed locally from evidence-field coverage | — | 0 |

Other `PayeeSignals` fields:
- `dormancy_days` comes from `max(block_time)`, which can be added to both queries at 0 extra calls.
- `appears_in_other_listings` is the count of Bazaar resources sharing the `payTo`, from the catalog at 0 credits.
- `funder_fanout` is computed locally from the catalog.

## Validation against a public explorer

Reference: [BaseScan token transfers for 0xf567…cb98](https://basescan.org/tokentxns?a=0xf567cfe0fdb87a1d6ca330e3f30f0d3da0f7cb98) (api.402rates.com payee), retrieved 2026-11-08 at about 16:30 UTC.

| metric | Surf query | BaseScan | delta |
|---|---|---|---|
| first seen | 2026-07-31T09:06:07Z (`first_inbound_at` 1785488767) | 2026-07-31 9:06:07 (block 49349710, oldest row) | **0 s** |
| first funder | 0x278ee9a9…82de | 0x278eE9A9…82DE | **match** |
| transfer count | 353 (351 in + 2 out) | "A total of 342 txns found" (ERC-20) | **+11 (+3.2%)** |

The count delta is unexplained but bounded. The most likely cause is that BaseScan hides "suspicious, unsafe, spam" tokens by default, so it counts fewer. Surf's data lags about 24h, which would push the other way.

Blockscout's API was behind a Cloudflare bot challenge, so I didn't use it.

## Billing model

**billing: per-job.** Cost is per call by endpoint tier, not per row or per payee.

| run | calls | payees | credits / call | total |
|---|---|---|---|---|
| inbound + outbound | 2 | 2 | 5, 5 | 10 |
| inbound + outbound | 2 | 12 | 5, 5 | 10 |

The same credits for 6× the payees rules out per-row and per-payee pricing. The official pricing page ([agents.asksurf.ai/docs/pricing](https://agents.asksurf.ai/docs/pricing), retrieved 2026-11-08) agrees: credits are charged per call by tier.

Docs vs measured:

| call | docs | measured |
|---|---|---|
| on-chain SQL | 4 (Heavy) | 5 |
| labels | 4 | 1 |
| schema | 4 | 1 |

The arithmetic below uses whichever is higher for each.

Other notes:
- The async route (`onchain-sql-job-create`) returned `UNAUTHORIZED` without a key. I couldn't verify that polling is free; the docs say it is. On the free tier the UNION query is split into two synchronous single-branch queries.
- An identical request repeated within 10 s is free (docs). Async jobs with equivalent SQL also return the retained job.

## Budget arithmetic ($10)

- $10 ÷ $0.006 per credit (list price) = **1,666 credits**. The minimum top-up is $20 (3,333 credits).
- One audit **batch** of B payees costs:
  - 3 SQL calls (payee inbound, payee outbound, funder outbound for the fanout heuristic) at 5 = 15
  - labels: ⌈2B/100⌉ calls at 4 (docs rate)
- At B = 200 payees per batch: 15 + 4 × 4 = **31 credits per batch** ($0.186).
- 1,666 ÷ 31 = **53 batches = 10,600 payees**.
- Endpoint probes (unpaid GET) and the Bazaar catalog cost **0 credits**, so endpoints add no credit cost. They're limited only by the 1 req/sec politeness rate.
- Free tier, no key: 30 credits/day fits one 200-payee batch per day (31 credits is one over at the docs label rate; it fits at the measured 1-credit rate).

So credits don't limit the audit: $10 covers more payees than the Base catalog is likely to contain. What does limit it:
1. The synchronous 30 s timeout per query. 12 payees took 4.4 s; B = 200 is untested.
2. The catalog's distinct payee count, which needs a full enumeration (0 credits) to know.

## Exchange exclusion (kinship vow)

**Label support: yes.** `wallet-labels-batch` returns `entity_type`, which marks CEX wallets: Bybit `0x6fa5…5a1d` and Bitrefill `0x480c…846a` came back as `cex`.
- Coverage was 6 of 23 addresses, so unlabelled funders fall back to the fanout heuristic: ≥500 distinct outbound receivers in the window counts as exchange-like.
- Both rules are in `funderLabelsFromSurf()` (`src/adapters/surf.ts`) and tested in `tests/surf-labels.test.ts`.
- Token contracts (`entity_type` `stablecoin`, e.g. the USDC contract recorded as Bitrefill's "first funder") are not funders, so that `first_funder` is treated as missing.

## Bazaar catalog shape

**Payees exposed: yes.**
- Each `items[]` entry has `resource`, `accepts[]` (`payTo`, `network`, `amount`, `asset`, `scheme`, `maxTimeoutSeconds`, `extra`; some also have `recipient`, `currency`, `maxAmountRequired`), `description`, `serviceName`, `type`, `x402Version`, `lastUpdated` and `quality`.
- `pagination.total` is 34,158. Query parameters `network=` and small `limit=` are ignored: the response always has the same total, and `limit=1` returns 20.
- Page 1: 198 of 200 resources are Base (`eip155:8453`), with 80 distinct payees. If that holds across the catalog, about 33,800 Base resources can be listed without probing. That figure is an extrapolation and the distinct payee count is unknown.
- Full enumeration: about 171 pages of 200 (about 120 MB), 0 credits.

## Schema deltas for PayeeSignals

| field | change | reason |
|---|---|---|
| `wallet_age_hours` | keep; add `age_floored: boolean` | Age is a lower bound. It's true when first_seen equals the window start; laso.finance hit exactly 2025-11-08 |
| `first_seen_at` | add (unix seconds) | Lets anyone re-derive age from a stored snapshot without the clock |
| `tx_count` | rename to `transfer_count` | It counts token/native transfers, not transactions. BaseScan shows 0 "transactions sent" for a payee with 342 transfers |
| `inbound_count` | add | Needed to compute repeat payers |
| `repeat_payers` | redefine as `inbound_count − distinct_inbound_senders` (proxy) | Not directly queried yet |
| `distinct_payers` | source from `distinct_inbound_senders` | Direct field |
| `total_received_usd` | source from `inbound_usd` | USD pricing lags about 3 days, so recent revenue undercounts |
| `first_funder` | skip token contracts (`entity_type` stablecoin/token) | USDC contract recorded as Bitrefill's "first funder" |
| `funder_label_source` | add: `surf-label` / `fanout-heuristic` / `none` | Makes the kinship exclusion auditable |
| `token_concentration` | redefine as the top token's share of `inbound_usd` | No holdings endpoint without a per-address loop |
| `appears_in_other_listings` | source from Bazaar (resources sharing `payTo`) | 0 credits |
| `identity.claims_*` | source from Bazaar `serviceName`/`description` via Dolphin; `corroborated` = label or ENS match | Labels cover about a quarter of addresses |

## Limits

- **Wallet age is first_seen within 365 days, and it's a lower bound.** Surf requires a `block_date` filter. Any payee active before the window shows `first_seen` equal to the window start; laso.finance shows exactly 2025-11-08. Widening the window costs nothing in credits but risks the 30 s synchronous timeout.
- **The Vow of Age is unaffected.** Its 48h threshold sits well inside the window, so any payee younger than 48h is fully visible. The identity vow's 7-day threshold is also inside the window.
- Data refreshes about every 24h, so a payee younger than a day may not appear yet. It then fails closed (silence vow → REVIEW), never ALLOW.
- Base only. Other chains have their own `*_transfers` tables, one query each.
- Label coverage is partial (6 of 23 here), and the fanout heuristic carries the rest.

## E signal: v1 → v2 (2026-11-08)

| | v1 (retired) | v2 (current) |
|---|---|---|
| input | `token_concentration`: share of inbound USD in the top token | `top_payer_share`: share of inbound USD from the top **sender**, plus distinct payers |
| formula | E = 1 − token share | E = min(1, log10(payers + 1) / 2) × (1 − max(0, top_payer_share − 0.30) / 0.70) |
| points | 10 × E | 10 × E |
| why changed | x402 sellers are paid in USDC by design. Measured `top_token_share` = 1.0 on both payees checked, so v1 gave every seller E ≈ 0 and docked 10 points across the board. | Measures what a buyer cares about: whether revenue depends on one payer (wash or self-dealing risk) or is spread across many. |

- `payers` excludes the first funder when Surf labels it an exchange. Other exchange or relayer senders aren't individually labelled at this scale, so that's a known limit.
- The field `token_concentration` is renamed `token_asset_share` and kept as information only, so it isn't required by the silence vow. `top_payer_share` is now required, so if it's missing the silence vow fires and the result is REVIEW.

Reference values from tests (`tests/score.test.ts`):

| case | E | points | note |
|---|---|---|---|
| 1 payer (sole payer, top 100%) | 0 | 0 | breadth factor alone is 0.1505, but a sole payer is 100% concentrated |
| 10 payers, top 40% | 0.4463 | 4.46 | |
| 100 payers, top ≤30% | 1.0 | 10 | |

Band change measured on cached data (`npx tsx scripts/e-diff.ts`, 0 credits):
- **Synthetic fixtures, 31 payees:** 1 changed. `0x44726a3e` went BLOCK (47.86) → REVIEW (50.08). v1 {ALLOW 10, REVIEW 13, BLOCK 8} → v2 {ALLOW 10, REVIEW 14, BLOCK 7}.
- **Real cached rows, 12 payees:** not measurable. Neither input was in the earlier query, so both versions return REVIEW via the silence vow. The real count comes from the audit run, where `artifacts/audit.md` reports v1 vs v2 for every audited payee.

Two buyers cannot be scored as reliable revenue — intentional. With two payers, the larger holds ≥50% of inbound USD, so the concentration factor is ≤0.71 and breadth is log10(3)/2 = 0.24, giving at most about 1.7 of 10 points.

## First unattended audit attempt (2026-11-09 02:01 UTC, free tier)

| call | payees | credits | ms | result |
|---|---|---|---|---|
| `payee-inbound` (with `top_payer_share`) | 100 | 5 | 34,146 | returned, but over the 30 s sync limit |
| `payee-outbound` | 100 | – | – | refused: `SQL_QUERY_IN_FLIGHT` |

What this run showed:
- **The new `sumMap` by sender makes the inbound query heavier.** 100 payees no longer fit a synchronous call (12 payees took 4.4 s before the change).
- **Surf can still count a slow synchronous query as running after it returns,** so the next call got `SQL_QUERY_IN_FLIGHT`.
- **The runner saved a batch only after both of its queries succeeded,** so the 5 paid credits produced no saved rows.

Fixes in phase 3g:
- Every SQL part is saved to the checkpoint as soon as it returns.
- The 24 s gate is checked after each call.
- Surf refusals (`SQL_QUERY_IN_FLIGHT`, `QUERY_TIMEOUT`, `SQL_SYNC_COOLDOWN`, 429 …) stop the run at the checkpoint, with no retry.
- The free-tier batch is now 50.
- A 5-credit paid gate checks `top_payer_share` before any batch runs.

Free-tier arithmetic at 50 payees per batch:
- 200 payees = 4 batches × 2 calls × 5 credits = 40, plus 1 funder call (5) and ≤4 label calls (4), so **49 credits**.
- Add 5 credits per night for the gate.
- At 30 credits a day the runner keeps going until the next call would not fit, which works out to **2 nights**:
  - Night 1: gate 5 + batch 1 in/out 10 + batch 2 in/out 10 + batch 3 inbound 5 = 30.
  - Night 2: gate 5 + batch 3 outbound 5 + batch 4 in/out 10 + funders 5 + labels 4 = 29.
  - Both nights resume from the checkpoint. This assumes no Surf refusals and labels at the measured 1 credit per call; at the documented 4, labels move to a third night.
