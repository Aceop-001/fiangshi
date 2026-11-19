# Known limits

Measured 19 Nov 2026 on branch `post-deadline/coverage`. The judged entry is `main` at commit `59b4712` (15 Nov 23:59 UTC); everything here is post-deadline.

## What it judges

Fiangshi judges x402 payees: a URL that answers HTTP 402 with machine-readable payment terms, whose payee is a Base wallet. Every other URL gets no band:

- **Not a 402** (a website, a redirect, an error, unreachable): `UNVERIFIED_ENDPOINT`, with deterministic signals (status chain, final host, content type, TLS) and no score.
- **A 402 with no usable terms**: `PAYMENT_TERMS_UNPARSEABLE`, with what the server sent and every place the parser looked.
- **Terms, but a payee outside the census**: `NO_RECORD` on the free route. The paid cold check ($0.15) fetches that wallet.

No path gives ALLOW without a census record and machine-readable terms.

## The hackathon endpoints

`docs/judge-coverage.md`, from `scripts/judge-coverage.ts`: 38 of 38 endpoints get a structured record. **0 verdicts were issued**: 37 are `UNVERIFIED_ENDPOINT` and 1 is `PAYMENT_TERMS_UNPARSEABLE`. That one, `repay-ready.vercel.app`, is Vercel refusing a disabled deployment (`DEPLOYMENT_DISABLED`), not an x402 offer. None of the 38 URLs, as given, is an x402 endpoint. Only those URLs were measured, not anything else the projects may serve.

## Money

- Settlement is a **dry run**. A paid check verifies the `X-PAYMENT` structure and returns a receipt; no facilitator settles it.
- The service's own wallet received 6 USDC transfers (4.711664 USDC, 5 payers, 13 to 15 Nov). These are on-chain transfers, not consumed billing. Three of those payers were first sent 0.10 USDC by the same wallet.

## The census

- It covers 1,923 Base payees (90-day window, Surf data), and that number does not change.
- The service's own wallet is **not** in it. `/v1/index.json` reports that wallet in a separate `self_coverage` block, built from Base USDC logs with no Surf call. It is ranked by the census policy unchanged, and comes out **BLOCK, score 48.98**: 6 days old, 5 payers, one of them 52% of revenue.
- That block reads USDC logs only, where the census reads every token. The free RPC keeps 72.81 of the 90 days. At the window start the wallet had no transactions and 0 USDC.

## Surf

Surf is called only on a paid cold check; `scripts/surf/*` is build-time. The free routes (`/check`, `/v1/preview`, `/v1/index.json`) make no Surf call and no model call.
