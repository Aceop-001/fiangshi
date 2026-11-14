# Sources for SUBMISSION.md

Where every figure in the submission write-up comes from.

## From `data/numbers.json`

- `census.payees`: 1,923
- `census.window_days`: 90
- `bands`: 127 ALLOW / 1,244 REVIEW / 552 BLOCK
- `freshness.payees_stale`: 1 · `freshness.stale_limit_hours`: 72
- `kinship.firing_funders`: 49
- `prices_usd`: $0.05 cached · $0.15 cold · $0.02 payee
- `credits.census_cost_per_payee_usd`: $0.00193

## Not in `data/numbers.json`, with their source

- $0.80 and the zero address for `api.cleave.fi`: live `GET /v1/check`, 14 Nov 2026 (receipt price 0.8, `vow_fired` `null_payee`, `cost_usd` 0).
- 355 tests across 38 test files: `npm test`, 14 Nov 2026. 17 acceptance gates: README ("accept 17 / 17").
- 0–436 of 552 BLOCKs: `artifacts/sensitivity.md` policy C (BLOCK 116; 552 − 116 = 436), quoted in the README.
- "49 unnamed": `artifacts/audit.md` ("0 exchange, 0 relayer, 0 individual, 49 unnamed").
- Costs $0.0019 / $0.0499 and margins 96% / 67%: `artifacts/costs.md`, "Pricing v3, as built" (`scripts/pricing.ts`).
- Payee-record cost and margin: not published.
