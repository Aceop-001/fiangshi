# Fiangshi: SERV Hackathon 02 submission

## What it is

Fiangshi checks who would receive an AI agent's payment before the agent pays. Give it a paid x402 web address and it answers ALLOW, REVIEW or BLOCK, quotes the evidence behind that answer, and seals a receipt anyone can re-check later. It never holds funds, never signs a transaction and never moves money: it advises, and the agent's own wallet decides.

## The problem

One endpoint in the public x402 catalogue, `api.cleave.fi/x402/gas`, asks $0.80 per call, payable to `0x0000000000000000000000000000000000000000`. That is the zero address: money sent there is gone for good, and nobody can ever deliver anything for it. An agent that pays it loses the money every time.

Every guard in this space asks how much an agent may spend. None asks who receives it. Fiangshi asks that question first, and blocks this endpoint at probe time, before any data or model call, at a cost of $0.00.

## How it uses SERV Reasoning

SERV Reasoning is the adjudicator in the middle of every full check.

- **Integration.** `POST https://inference-api.openserv.ai/v1/chat/completions`, model from `SERV_MODEL` (`gpt-5.4-mini` in production), with a strict JSON schema sent as `response_format` (`fiangshi_verdict`, `src/adapters/serv.ts`).
- **What goes in.** The payment terms, the payee's on-chain signals (age, first funder, distinct and repeat payers, concentration) and the deterministic score.
- **What comes back.** A band (`ALLOW`, `REVIEW` or `BLOCK`), citations as `{signal, quote}` pairs, and a short rationale. Every cited signal must exist in the stored evidence, and every quote must be a verbatim substring of it. A reply that fails is retried once with a stricter prompt.
- **Governance.** Six deterministic rules, the vows, run **after** the model and may only lower the band. The final band is the lowest of the score band, the model band and the vow band. A SERV failure, a timeout or a schema violation produces a degraded verdict capped at REVIEW: it can never raise a band, and it never stops the check from finishing. A model BLOCK is applied as REVIEW, because BLOCK needs a machine-checkable reason. SERV has zero authority to ALLOW anything the vows refuse.

The model advises; the vows decide.

## Track

**Open Track.**

The product is chain- and partner-agnostic: its core claim, payee-side diligence before payment, does not depend on any one partner's stack.

## What was built during 2–15 November

- The probe and 402 parser: one unpaid GET, x402 terms read from headers and body, `terms_hash` over canonical JSON (`src/adapters/probe.ts`).
- The census of all 1,923 Base payees in the catalogue, over a 90-day window (`scripts/audit.ts`, `data/numbers.json`).
- The six vows: `null_payee`, `age`, `kinship`, `history`, `identity`, `silence` (`src/core/vows.ts`).
- The scoring model: 25M + 20P + 20R + 15I + 10E + 10C (`src/core/score.ts`).
- Hash-chained receipts and `/v1/verify`, which recomputes every sha256 and chain link (`src/core/receipt.ts`).
- The paid x402 route: 402 with real terms, then 200 with a verdict and receipt; settlement is dry-run (`src/api/server.ts`).
- 355 tests across 38 test files, and 17 acceptance gates (`npm test`, `npm run accept`).
- The static index and site at fiangshi.xyz, with no script (`src/site.ts`).

## Evidence

| route | what a judge sees |
|---|---|
| `GET /health` | census size, census time, settlement mode |
| `GET /v1/index.json` | every census payee: band, score, vows fired, receipt id |
| `GET /v1/preview?url=` | free: unpaid probe, null-payee gate, census answer |
| `GET /v1/check?url=` | 402 with x402 v2 payment terms until paid |
| `GET /v1/verify?receipt=` | recomputes the hash and chain link of a receipt |

```bash
curl -s "https://api.fiangshi.xyz/v1/preview?url=https://api.cleave.fi/x402/gas"
curl -si "https://api.fiangshi.xyz/v1/check?url=https://api.bitrefill.com/x402/gift-cards/search"
```

- Repo: https://github.com/Aceop-001/fiangshi
- Live site: https://fiangshi.xyz
- Video: [VIDEO_URL]

## Honest limits

- **Settlement is dry-run.** No funds move. The paid route checks the payment header's structure and settles nothing.
- **Narrow data.** Base only, a 90-day window and a single data provider (Surf). Wallet age is a lower bound.
- **False blocks are a range, not a number.** Of 552 BLOCKs, between 0 and 436 would clear if every unnamed shared funder turned out to be an exchange (`artifacts/sensitivity.md`, policy C).
- **Kinship recall is unmeasured.** All 49 funders behind a kinship firing come back unnamed from Surf, so there is no labelled ground truth to score against.
- **One stale record.** 1 of 1,923 verdicts is past the 72-hour freshness window; a stale ALLOW would be capped at REVIEW.

This is by design. A check that hides its error bars is not a check.

## Revenue

| SKU | price | measured cost | margin |
|---|---|---|---|
| cached check | $0.05 | $0.0019 | 96% |
| cold check (payee not in the census) | $0.15 | $0.0499 | 67% |
| payee record | $0.02 | not published | not published |

The census itself cost $0.00193 per payee to build. Agents and the platforms that run them pay, per check, because one avoided payment to a dead-end wallet covers many checks.

<!--
Sources. data/numbers.json: census.payees (1,923), census.window_days (90), bands (127 / 1,244 / 552),
freshness.payees_stale (1), freshness.stale_limit_hours (72), kinship.firing_funders (49),
prices_usd (0.05 / 0.15 / 0.02), credits.census_cost_per_payee_usd (0.00193).
Not in data/numbers.json, with their source:
- $0.80 and the zero address for api.cleave.fi: live GET /v1/check, 14 Nov 2026 (receipt price 0.8, vow_fired null_payee, cost_usd 0).
- 355 tests, 38 test files: `npm test`, 14 Nov 2026. 17 acceptance gates: README ("accept 17 / 17").
- 0–436 of 552: artifacts/sensitivity.md policy C (BLOCK 116; 552 − 116 = 436), quoted in README.
- "49 unnamed": artifacts/audit.md ("0 exchange, 0 relayer, 0 individual, 49 unnamed").
- Costs $0.0019 / $0.0499 and margins 96% / 67%: artifacts/costs.md, "Pricing v3, as built" (scripts/pricing.ts).
- Payee-record cost and margin: not published.
-->
