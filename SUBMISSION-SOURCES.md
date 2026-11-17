# Sources for SUBMISSION.md

Where every figure in the submission write-up comes from.

## From `data/numbers.json`

- `census.payees`: 1,923
- `census.window_days`: 90
- `bands`: 160 ALLOW / 1,227 REVIEW / 536 BLOCK (17 Nov refresh)
- `freshness.payees_stale`: 1 · `freshness.stale_limit_hours`: 72
- `kinship.firing_funders`: 49
- `prices_usd`: $0.05 cached · $0.15 cold · $0.02 payee
- `credits.census_cost_per_payee_usd`: $0.00168 (540 credits × $0.006 / 1,923), also used as the payee-record cost (a payee record serves that census row); margin (0.02 − 0.00168) / 0.02 = 91.6%, shown as ~92%

## Not in `data/numbers.json`, with their source

- $0.80 and the zero address for `api.cleave.fi`: live `GET /v1/check`, 14 Nov 2026 (receipt price 0.8, `vow_fired` `null_payee`, `cost_usd` 0).
- 355 tests across 38 test files: `npm test`, 14 Nov 2026. 17 acceptance gates: README ("accept 17 / 17").
- 0–450 of 536 BLOCKs: `artifacts/sensitivity.md` policy C (BLOCK 86; 536 − 86 = 450), quoted in the README.
- "48 of the 49 unnamed": the 17 Nov checkpoint (`fixtures/audit/checkpoint-sample-census-r3-w90.json`): of the 49 funders behind a kinship firing, 1 has a Surf label (type `misc`, not an exchange or relayer) and 48 have none.
- Costs $0.0019 / $0.0499 and margins 96% / 67%: `artifacts/costs.md`, "Pricing v3, as built" (`scripts/pricing.ts`).