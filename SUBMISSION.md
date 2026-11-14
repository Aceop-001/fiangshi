# Fiangshi: SERV Hackathon 02 submission

## What it is

Fiangshi checks who would receive an AI agent's payment before the agent pays. Give it a paid x402 web address and it answers ALLOW, REVIEW or BLOCK, quotes the evidence behind that answer, and seals a receipt anyone can re-check later. It never holds, signs or moves money.

## The problem

One endpoint in the public x402 catalogue, `api.cleave.fi/x402/gas`, asks $0.80 per call, payable to `0x0000000000000000000000000000000000000000`. That is the zero address: money sent there is gone for good, and nobody can ever deliver anything for it. An agent that pays it loses the money every time.

Every guard in this space asks how much an agent may spend; Fiangshi asks who receives it, and blocks this endpoint at probe time for $0.00.

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

- The probe and 402 parser: one unpaid GET, x402 terms read from headers and body, `terms_hash` over canonical JSON.
- The census of all 1,923 Base payees in the catalogue, over a 90-day window.
- The six vows: `null_payee`, `age`, `kinship`, `history`, `identity`, `silence`.
- The scoring model: 25M + 20P + 20R + 15I + 10E + 10C.
- Hash-chained receipts and `/v1/verify`, which recomputes every sha256 and chain link.
- The paid x402 route: 402 with real terms, then 200 with a verdict and receipt; settlement is dry-run.
- 355 tests across 38 test files, and 17 acceptance gates.
- The static index and site at fiangshi.xyz, with no script.

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
| payee record | $0.02 | $0.00193 | ~90% |

The census itself cost $0.00193 per payee to build. Agents and the platforms that run them pay, per check, because one avoided payment to a dead-end wallet covers many checks.

Every figure's source: [SUBMISSION-SOURCES.md](SUBMISSION-SOURCES.md).
