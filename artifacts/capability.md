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
| E exposure | partial | No holdings in SQL. `wallet-detail` has tokens but takes one address per call, which would be a per-entity loop (forbidden) | Top token's share of `inbound_usd` by `contract_address`, added to the inbound query | 0 (same query) |
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
