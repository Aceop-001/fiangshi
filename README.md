# Fiangshi

Pre-payment counterparty oracle for x402 agent payments. Give it a paid endpoint URL, and it returns **ALLOW / REVIEW / BLOCK** with quoted evidence and a hash-chained receipt you can re-run. Advisory only, and it never holds funds.

> The model advises, the vows decide.

## Quickstart (offline, no keys)

```bash
npm install
npm run accept
npm run fiangshi -- check https://fresh-oracle.example/v1/price --explain
```

## How a verdict is made

1. **Probe**: an unpaid GET, then parse the x402 402 `accepts[]` into Terms. `terms_hash = sha256(canonical)`.
2. **Snapshot**: one batched data pass over the deduped payees. `snapshot_id = sha256(payload)`.
3. **Score**: `25M + 20P + 20R + 15I + 10E + 10C`. ≥80 ALLOW, 50–79 REVIEW, <50 BLOCK.
4. **Model** (SERV): strict JSON. Every citation must name an existing evidence key and quote an exact, non-empty substring. Invalid output gets one stricter retry, then the verdict is degraded.
5. **Vows**: these run last and can only lower the band. The rules are age, kinship, history, identity and silence.
6. **Receipt**: canonical JSON, sha256, `prev_hash` chain, kept in `data/ledger.jsonl`.

## Design decisions (where the spec is silent)

- Final band = `min(scoreBand, modelBand, vowBand)`.
- If **silence** fires, the score band is REVIEW. An incomplete score is not a reason to BLOCK.
- A degraded model counts as REVIEW. A model **BLOCK** is applied as REVIEW, because BLOCK needs a machine-checkable reason (a vow, or a score under 50 from complete signals).
- **Kinship** ignores funders labelled CEX, so an exchange hot wallet funding many sellers doesn't count.
- Invalid data (negative age, future creation time, NaN, concentration outside [0,1], a payee funding itself) is cleaned up to "missing", which gives REVIEW and never BLOCK.
- The reported `vow_fired` is the most severe vow that fired. Ties go to the listed order.
- Unknown asset decimals give `price = null`, which triggers silence and REVIEW.
- Receipts are **hash-chained, not signed**. Each one carries `receipt_hash = sha256(canonical)` and the previous receipt's hash, so editing, removing or reordering any receipt fails `fiangshi verify`. There is no signing key to manage or leak.

## NOT doing

No dashboard, auth, admin panel or DB server. No custody, signing or sending of transactions. No per-entity API loops.

## Status

- Offline gate: `npm run accept` passes 10/10 with zero network calls.
- **Fixtures are synthetic** (`scripts/gen-fixtures.ts`), shaped like x402 v1 responses and PayeeSignals. They still need replacing with 10 real recorded 402s during API wiring.
- Not built yet: live Surf/SERV/Dolphin wiring, HTTP API (phase 8), Kite seller flow, lab matrix (phase 9), hourly index regeneration.

## Build Log

**Phase 0 (skeleton)**
- Added CLAUDE.md, the companion prompts in docs/, TS strict, vitest and zod (1 runtime dep).
- Froze the zod contracts in `src/core/types.ts`, plus canonical JSON and sha256.
- Set up a local git repo only. No remote.
- Added `.env.example` with every env var named. Real keys go in `.env`, which is gitignored.
- 3 tests.

**Phases 1–7 (offline)**
- Probe parses x402 v1 bodies. Prices are converted for known USDC assets only.
- The snapshot dedupes payees, recomputes ≤2-hop kinship locally and has a stable id.
- Score and vows are pure functions with table-driven tests. A test confirms model ALLOW loses to a vow BLOCK.
- Added SERV validation (JSON, schema, signal exists, substring), one stricter retry and a degraded fallback. Mocks exist only in the adapter.
- Added receipts, a JSONL ledger, chain verification, drift rules and 72h policy decay. The Dolphin hash cache has a tested cache hit.

**Local verification**
- `npm run accept`: 10 gates, run under a no-network preload in this process and in every child process. Runs in about 4s.
- `check --explain` prints signals, components, the vow table, the citation substring checks and the final band.
- Added `tests/contract.test.ts` (schema round-trips; any missing field gives REVIEW) and `tests/adversarial.test.ts` (12 attacks).
- 104 tests, all offline.
- Budget guard: caps per provider, refuses call N+1, writes to `artifacts/costs.md`.

**Phase 3b–3d (Surf, real payees)**
- Installed surf 1.0.11 using the checksum-verified official installer. Recorded 12 real x402 v2 402s from the Bazaar catalog; all parse after adding v2 support (body or `payment-required` header).
- Queried payee facts over 2 and 12 real payees: 5 credits per SQL call either way, so **billing is per call, not per payee**. 22 free-tier credits used in total.
- Validated against BaseScan: first-seen matches to the second and the first funder matches; transfer count is +3.2% (353 vs 342).
- `wallet-labels-batch` returns `entity_type: cex` (Bybit, Bitrefill). It drives the kinship exclusion, with a fanout-≥500 heuristic for unlabelled funders.
- `artifacts/capability.md`: component table, schema deltas, $10 arithmetic (≈10,600 payees) and the age-is-a-lower-bound limit.

**Phase 3f (E v2, parser fix, model wiring)**
- **E v2 = payer concentration.** E = min(1, log10(payers+1)/2) × (1 − max(0, top_payer_share − 0.30)/0.70). v1's token concentration is now `token_asset_share`, kept for information only; x402 sellers are about 1.0 on it by design. `top_payer_share` comes from the same SQL call.
- **Band change (`scripts/e-diff.ts`):** 1 of 31 synthetic payees changed (BLOCK→REVIEW). Real cached rows lack the inputs, so the real count comes from the audit.
- **Parser fix:** each `accepts[]` entry is validated on its own. 5 of the 7 unparseable 402s from the 200-payee probe now parse; a multi-chain server's decimal-amount XRPL/Hyperliquid option used to hide its valid Base option.
- **SERV (chat completions, documented `max_completion_tokens` + strict `json_schema`) and Dolphin (documented base URL and model) are live-wired.** 16 tests cover malformed output, timeout, empty body, HTTP errors and truncation, all failing closed.
- **Model smoke (`scripts/smoke.ts`) is ready but BLOCKED:** no SERV or Dolphin key in the environment, 0 calls. The env prefix is fixed (`FIANGHSI_` → `FIANGSHI_`).

**Phase 3g (audit gate + fixture guard)**
- **First unattended run (2026-11-09 02:01 UTC):** the 100-payee inbound call took 34.1 s, over the sync limit, and the next call was refused with `SQL_QUERY_IN_FLIGHT`. The runner discarded that paid result: 5 credits, no rows.
- **Runner now:** saves every SQL part immediately, checks the 24 s gate after each call, stops on Surf refusals without retrying, and uses a free-tier batch of 50.
- **Paid gate:** `audit.ts gate` (5 credits) asserts `top_payer_share` is a float in [0,1] on 5 known payees and not all 1.0, before any batch. On failure it writes `artifacts/audit-failure.md`.
- **Fixture guard:** `tests/fixture-integrity.test.ts` and accept gate G11 require ≥12 non-empty real 402s that all parse. `npm run accept` is now 11/11.
- E v2 kept as is (0 / 4.46 / 10 in tests). `.env` confirmed ignored by git (`git check-ignore`).

## Pricing (v2)

| check | cost (measured) | cost (conservative) | price | env |
|---|---|---|---|---|
| **cold**: payee not in the snapshot (3 Surf SQL + 1 label call + SERV + Dolphin) | $0.0979 | $0.1159 | **$0.15** | `FIANGSHI_PRICE_CHECK_COLD` |
| **cached**: snapshot hit (SERV + Dolphin only) | $0.0019 | — | **$0.05** | `FIANGSHI_PRICE_CHECK` |

- The measured column uses account balance deltas: 4 credits per keyed SQL call and 4 per label call.
- The conservative column takes `meta.credits_used` at face value for SQL (5 a call).
- Surf bills per call, so the census is what makes cached checks cheap. At 50 payees per call the Surf share falls to $0.00384 a payee.
- **Census amortisation (800 payees, 90-day window):** $0.00102 per payee for the payee pass, including one billed killed call. That rises to $0.00189 with the refused funder pass and the partial label pass. The planning estimate was $0.00059.
- All figures come from `npx tsx scripts/pricing.ts`; full tables are in `artifacts/costs.md`.

## Provider quirks (found on live calls, 2026-11-08/09)

- **Dolphin (DeepSeek V4.1 Flash) returns an undocumented `reasoning` field.** On the first live call it used all 200 output tokens, leaving the JSON answer empty (`finish_reason=length`). Fiangshi failed closed: no claims, nothing cached. The token cap is now 1,024; that reply took 475 output tokens.
- **SERV returns no cost field.** Chat completions carries `usage` tokens only; cost appears in the console. Fiangshi computes cost as tokens × the price from `/models`, which gives pricing in cents per million (`"input": 100` = $1.00/M). The model list is under `items[]` with `modelId`, not OpenAI's `data[].id`.
- **SERV's "reasoning" is not a response field on chat completions.** A reasoning trace exists only on `/v1/responses`, for OpenAI models. Fiangshi requires its own `rationale` field through strict `json_schema` instead.
- **Surf async has a scan ceiling that preflight does not show, and the rejection is billed.** Preflight accepted a 50-payee inbound query (15.45 M of a 150 M-row budget, 2.21 of 17.2 GB). The same SQL as an async job was rejected in 45 ms with `QUERY_FAILED: scans too many rows or bytes`, and 4 credits were charged.
- **Surf sync refusals are billed too.** `SYNC_QUERY_REQUIRES_ASYNC` (122 M rows estimated for 50 payees) cost 4 credits. A slow sync query can also leave the next call refused with `SQL_QUERY_IN_FLIGHT`.
- **Surf's `meta.credits_used` is not the bill.** It reports 5 for a keyed sync SQL call that costs 4, and 1 for a keyed label call that also costs 4 (27 calls, balance 184 → 72). Trust the balance delta.
- **`wallet-labels-batch` fails above about 20 addresses,** although the docs allow 100. At 50 and 100 it returned exit 4 with `{"error_code": "INTERNAL_ERROR", "success": false}`, a different error shape from the usual `{error: {code}}`, and was not billed. Fiangshi now fails closed on both shapes and uses groups of 20.
- **A killed sync call is still billed.** A query cut off at the 25 s per-call limit cost 4 credits and returned no rows.

**Phase 3k (uniform 90-day audit, 800 payees)**
- **Census:** 800 of 1,923 Base payees, all at a uniform 90-day window; the 365-day rows are archived as `checkpoint-*-w365.json`. 16 chunks of 50 at 8 credits each (balance delta). One call was killed at the 25 s limit and billed; its set was bisected, never re-sent. 0 payees excluded.
- **Funders and labels:** the funder pass was refused for scan size (exchange hot wallets), so exchanges are excluded by Surf label only. Labels fail above about 20 addresses per call; the label pass covered 440 of 1,291 addresses before the 72-credit floor stopped it.
- **Bands (E v2, two-tier M for the 90-day dataset):** 16 ALLOW · 471 REVIEW · 313 BLOCK. E v1 → v2 changed 31 bands. All 264 kinship BLOCKs rest on unlabelled funders, so they're reported as an upper bound.
- **ALLOW hunt (full pipeline, SERV + Dolphin in parallel):** attempt 1 0/3 (Dolphin timed out), attempt 2 1/3. `api.you.com` survived as ALLOW end to end; p50 full check about 15 s, dominated by Dolphin.
- **Finding:** the top score is the zero address. A live 402 asks for $5 to `0x000…0` and scores 80.9, because no vow covers null or burn payees. A sixth vow is proposed, not added.
