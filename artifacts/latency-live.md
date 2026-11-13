# Live latency

Measured by `npx tsx scripts/latency-live.ts --write` against `https://api.fiangshi.xyz` at 2026-11-13T08:15:41.733Z, from one client, requests in sequence.
Each sample is a full `GET /v1/preview` round trip, including the live unpaid probe of the seller's endpoint, so the
seller's own response time is part of every number. One warm-up request per path is not counted.

| path | answer | samples | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| census payee (warm) | ALLOW | 20 | 469 | 508 | 953 |
| null-payee gate | BLOCK | 20 | 279 | 360 | 435 |
| not an x402 endpoint | no_verdict | 20 | 270 | 315 | 379 |

## Not measured here

- **Cold check** (a payee outside the census, via the paid `/v1/check`): one live run on 11 Nov took 10,772 ms
  (`artifacts/cold-live.md`). That is one sample, not a distribution. The public API does not run cold checks yet.
- **First request after the free-tier instance sleeps**: Render starts it on demand, which takes up to about a minute.

## Timeout contract

| stage | limit | what the caller gets when it is exceeded |
|---|---|---|
| unpaid probe of the seller | 15 s | `no_verdict` with `probe failed` (never ALLOW) |
| SERV model advice (paid check) | 15 s, one stricter retry | REVIEW, `degraded: true` |
| Dolphin name extraction (paid check) | 12 s, one retry | band unchanged, `enrichment: incomplete` |
| Surf cold lookup (paid check) | 25 s per call (`FIANGSHI_SURF_CALL_TIMEOUT_MS`; 60 s if unset) | REVIEW with `surf_error` on the receipt |

A free check therefore answers within about 15 s plus network time once the server is awake, and a paid check within
about a minute plus the Surf calls in the worst case. Whatever the delay, a timeout produces REVIEW or no verdict, never ALLOW.
