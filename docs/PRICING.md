# Pricing

Fiangshi is paid per request with [x402](https://x402.org): your agent asks, gets an HTTP 402 with the price, pays in USDC on Base, and gets the answer. There is no account, no API key, no subscription and no stored balance. Fiangshi never holds your money: the payment goes from your wallet straight to the operator's wallet.

## Free

| route | what you get |
|---|---|
| `GET /v1/preview?url=` | One unpaid look at the endpoint, the null-payee rule, and the census answer for its payee. No model call. |
| `/check?url=` | The same, as a page. |
| `GET /v1/index.json` | Every census payee with its band, score and receipt id. |
| `GET /v1/verify`, `GET /v1/receipts/{id}` | Re-check any receipt: hash, band, chain link. |
| `GET /v1/census/status`, `GET /v1/stats` | How fresh the census is; checks served and USD settled in the last 24 hours. |
| A null payee | A seller asking to be paid to the zero address or a burn sink is answered BLOCK on `/v1/check` for $0.00, before any payment is asked. |

## Paid checks

| SKU | price | when it applies |
|---|---|---|
| Cached check, `GET /v1/check?url=` | **$0.05** | The payee is in the census, or was fetched in the last 72 hours. Full verdict: score, model advice, the six rules, a sealed receipt. |
| Cold check, `GET /v1/check?url=` | **$0.15** | The payee is new to Fiangshi: its on-chain history is fetched live first. |
| Payee record, `GET /v1/payee/{address}` | **$0.02** | The census record for one wallet. Never charged when there is no record. |

The 402 always quotes the price that applies to your request, so your agent pays exactly that.

## Agent plan: batch

`GET /v1/batch?url=…&url=…` checks up to **10** endpoints under **one** x402 payment, at **20% off** the summed prices of the checks in it (10 cached checks: $0.40 instead of $0.50). Every check still gets its own receipt, and a null payee in the batch is answered free and not charged. Like every other route, a batch needs no account and leaves no balance behind: it is a single payment for a single request.

## Settlement

**Live since 25 Nov 2026.** The first settled check: $0.05 USDC on Base, tx [`0x90b91981…9696`](https://basescan.org/tx/0x90b919810c9c3a3b6707a1847261d00609018ca42bd15ff9a2fcd10867af9696) (2026-11-25 04:15 UTC, from the operator's own test wallet; see the [test report](REPORT.md), F28).

Payments are verified and settled by the Coinbase CDP x402 facilitator when the operator turns live settlement on (`FIANGSHI_SETTLE=live`); a settled answer's receipt then carries `settlement: "settled"` and the Base transaction hash. Until then the service runs in dry-run: payments are checked for structure and nothing is charged. `GET /health` says which mode is on, and `GET /v1/stats` counts only payments that actually settled.
