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
