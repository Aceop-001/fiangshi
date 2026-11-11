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
- **Synthetic fixtures, 31 payees:** 1 changed. `0x44726a3e` went BLOCK (47.86) → REVIEW (50.08); no other synthetic payee changed band.
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

## Identity v3 (2026-11-09, as specified)

**Why it changed.** In the live ALLOW hunt, Dolphin extracted a claimed name from a seller's own listing for `0x93053f1e…`. Under v2 an uncorroborated claim scored I = 0, below an anonymous seller's 0.5. The score fell **80.91 → 75.07** (ALLOW → REVIEW) just because the extraction succeeded. v2 penalised self-claims for existing.

| identity | v2 | v3 |
|---|---|---|
| no claim | 0.5 | **0** |
| self-claim only | 0 | **0.25** |
| self-claim + 1 independent source | 1.0 (any corroboration) | **0.5** |
| self-claim + 2 sources | 1.0 | **0.75** |

- **Sources** (`src/core/identity.ts`): the 402 resource URL host, a URL path segment, the catalog listing name (only when the claim came from elsewhere), and a Surf `entity_name` label.
- **SERV/Dolphin agreement is only a hook.** SERV emits no identity claim, so it is never set.
- **No circular evidence.** Dolphin sees the listing text only, never the URL, so a claim is never corroborated by the text it came from.
- **Generic words are ignored:** `x402`, `api`, `tool`, `data`, `gateway` and similar.

**Effect on the 800-payee census:** every v3 ALLOW carried a corroborated self-claim (`npx tsx scripts/show-allow.ts`). Superseded twice since (sections below); the current band counts are stated once, at the end of this page.

**Gate result: `api.you.com` is REVIEW (75.33)**, so the "still ALLOW" gate fails. It has no catalog listing name, which means 0 claims and I = 0. Predicted by `scripts/sim-identity-v3.ts` and accepted on 2026-11-09. Regression test: "Acme" at acme.example.com scores ≥ the same payee with no listing (`tests/identity.test.ts`).

## Optional enrichment and V5 at any age (2026-11-09, "phase3b-fix")

1. **Dolphin is optional enrichment:** 12 s per attempt, one retry on timeout only. A failure no longer caps the band and never fires silence. The receipt carries `enrichment: {status: "incomplete", reason}`. **Required** signals are the Surf snapshot fields; missing any of them still fires V1 silence (REVIEW).
2. **Identity with no claim is renormalised away.** I is dropped and the score is computed over the remaining 85 weight points.
3. **Reconciling rule (flagged):** "no claim → renormalise" and "a self-claim is never penalised for existing" conflict. Renormalised, a payee with no claim scores at its other components' average, while a listed payee adds 15 × I with I ≤ 0.75. So any listing would score below no listing whenever the other components average more than I. Resolution: **optional components can only add**. A payee with a claim scores max(with I, renormalised without I). Both rules hold, and an uncorroborated claim is still caught by V5.
4. **V5 identity (superseded below):** an uncorroborated claim → REVIEW at any age; a contradicted claim → BLOCK.

**Effect:** anonymous-but-healthy payees (no listing, I renormalised away) such as `api.you.com` reached ALLOW. The lab run under these rules (`fixtures/lab/results-attempt3.json`) matched 9/9 pre-written expectations.

## Identity neutrality (2026-11-09, "phase3h"): extraction must never penalise being examined

**Why it changed.** The ALLOW composition audit (`npx tsx scripts/allow-composition.ts`, 0 credits) showed the rule above still penalised examination. Census receipts carry `enrichment: skipped` (no model calls), so the census was partitioned by what identity examination found:

| identity examination | payees | ALLOW before | ALLOW after |
|---|---|---|---|
| no claim (weight excluded) | 314 | 12 | 12 |
| claim, 0 corroborating sources | 63 | **0** | **5** |
| claim, 1 source (I 0.5) | 342 | 26 | 26 |
| claim, 2+ sources (I 0.75) | 81 | 6 | 6 |
| contradicted | 0 | 0 | 0 |

A payee whose listing name was examined and found uncorroborated could never ALLOW (V5 REVIEW), while the same payee with no listing could. Live, all three lab ALLOWs had `enrichment: incomplete`: an ALLOW was reachable only when the extractor failed to examine the seller.

| identity | I component | vow |
|---|---|---|
| no claim | weight excluded (renormalised) | none |
| claim, no corroboration | weight excluded: **identical to no claim** | none |
| claim + 1 independent source | 0.5 | none |
| claim + 2 sources | 0.75 | none |
| claim contradicted by a Surf label | (any) | **V5 BLOCK** |

The "optional components can only add" rule stays, so a corroborated claim never scores below no claim. Regression tests (`tests/identity.test.ts`): "Acme" at acme.example.com scores ≥ no listing; an uncorroborated claim scores **exactly** like no claim and fires the same vows; a contradicted claim is the only identity outcome that BLOCKs.

**Lab** (`fixtures/lab/results-attempt4.json`, expectations in `cases-v2.json` left unedited): **8/9**. B4 (anon-claimant, expected REVIEW · identity) still lands on REVIEW by score (60.49), but V5 no longer fires, so it is recorded as a FAILURE against its pre-written expectation. The synthetic lookalike fixture still BLOCKs, by score (48.3) rather than by V5.

**Current census band counts (the only split stated on this page):** **49 ALLOW · 539 REVIEW · 212 BLOCK** of 800, as defined in `data/numbers.json` (`npx tsx scripts/numbers.ts`).

## Operator labels only (2026-11-10)

The identity vow had fired on one census payee, and it was a false positive. The listing said "Crawl Pre-Flight"; Surf labelled the wallet with a person's social handle (`entity_type: individual`). The two share no word, so the old rule called it a contradiction and BLOCKed. A person selling a product under another name contradicts nothing.

A label now contradicts a claim only when it names the wallet's **operator** (`operatorName` in `src/core/identity.ts`): it must have an `entity_type`, must not be `individual`, and must not be a deposit address (`casino_deposit`, "OKX Deposit"), which names the platform where the owner is a customer. Tests: `tests/identity.test.ts`. That payee moves BLOCK to REVIEW; nothing else changes. The composition table and band counts above are for this rule.

The same test decides whether a label can stand in as a seller's name when the catalog gives none. Two census payees are labelled as deposit addresses (an exchange's and a casino's): they now count as having no claim. Their scores move 78.54 → 76.58 and 49.83 → 47.84 and neither changes band. A label naming a person is never used as a name and never printed.
