# Fiangshi guide

Fiangshi answers one question before an agent pays an x402 endpoint: who is on the other side of this payment? It returns ALLOW, REVIEW or BLOCK, quotes the evidence it used, and seals a receipt you can verify later. It is advisory only and never holds funds.

This guide covers the agent flow, how a verdict is made, and how to run Fiangshi yourself. Examples use the local default address, `http://127.0.0.1:8787`.

## The agent flow

### 1. Ask before you pay

```bash
curl -i "http://127.0.0.1:8787/v1/check?url=https%3A%2F%2Fapi.cleave.fi%2Fx402%2Fgas"
```

Fiangshi makes one unpaid request to the endpoint, reads the payment terms from its 402 response, and answers in one of two ways.

**A free BLOCK.** If the payment address is a dead end (the zero address, a burn address, the token contract itself, or an address that fails its checksum), the answer is immediate and costs nothing. No data or model call is made.

```json check-block
{
  "mode": "live",
  "band": "BLOCK",
  "vow_fired": "null_payee",
  "reason": "zero_address: payTo 0x0000000000000000000000000000000000000000 is the zero address: funds sent there are unrecoverable",
  "cost_usd": 0,
  "model_calls": 0,
  "receipt_id": "a15e6048e6d4780cefa285c278ee1905c2ca36dc85ee40b2dd1a520356bd0c7b",
  "receipt": {
    "payee": "0x0000000000000000000000000000000000000000",
    "url": "https://api.cleave.fi/x402/gas",
    "terms_hash": "45612702028560689a15d922fe0378122426a12de418a4d161534db7a7791183",
    "price": 0.8,
    "band": "BLOCK",
    "score": 0,
    "vow_fired": "null_payee",
    "evidence": [
      { "signal": "payee", "quote": "zero_address: payTo 0x0000000000000000000000000000000000000000 is the zero address: funds sent there are unrecoverable" }
    ],
    "model": { "verdict": null, "extractor": "none", "degraded": false },
    "snapshot_id": "24b754577acdebdc5a358ea60df9314147c088774633eacfc676231d4973bcc2",
    "checked_at": "2026-11-10T07:00:53.938Z",
    "settlement": "dry-run",
    "chain": "eip155:8453",
    "prev_hash": "genesis",
    "receipt_hash": "a15e6048e6d4780cefa285c278ee1905c2ca36dc85ee40b2dd1a520356bd0c7b"
  },
  "settlement": "dry-run",
  "ms": 8
}
```

**A payment request.** Every other endpoint gets a 402 with x402 v2 payment terms. The same terms are also sent base64-encoded in the `payment-required` response header.

```json check-402
{
  "mode": "live",
  "x402Version": 2,
  "error": "X-PAYMENT header is required",
  "resource": {
    "url": "http://127.0.0.1:8787/v1/check?url=https%3A%2F%2Fx402.tbs-digital.com%2Fweather%2Fcurrent",
    "description": "Fiangshi counterparty check",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "amount": "50000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ]
}
```

`amount` is in atomic USDC (6 decimals), so `50000` is $0.05. `payTo` is the operator's wallet, set with `FIANGSHI_PAYTO`. If the operator has not set one, paid routes answer 503 instead of inventing an address.

### 2. Pay and get the verdict

Send the same request again with an `X-PAYMENT` header. Its value is the base64 encoding of a JSON payment payload for the terms you were given:

```json x-payment
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:8453",
  "payload": {
    "signature": "0x1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111",
    "authorization": {
      "from": "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "to": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "value": "50000",
      "validAfter": "1794293993",
      "validBefore": "1794294653",
      "nonce": "0xabababababababababababababababababababababababababababababababab"
    }
  }
}
```

> Settlement is a dry run in this build. The header is checked for structure: addresses, amount, time window, nonce and signature length. The signature is not verified, nothing is settled and no transaction is sent. The signature above is a placeholder, not a real one.

The verdict (evidence list shortened here):

```json check-paid
{
  "mode": "live",
  "band": "ALLOW",
  "score": 86.43,
  "vow_fired": null,
  "vows": [],
  "model": { "serv": "ALLOW", "degraded": false },
  "enrichment": { "status": "complete", "reason": null },
  "in_census": true,
  "sku": "cached",
  "cold": null,
  "probe": { "price": 0.001, "payee": "0xd6fce15298fc9d60f867d9455d497177da9bfb0a" },
  "cost_usd": 0.05,
  "payer": "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "settlement": "dry-run",
  "model_calls": 0,
  "receipt_id": "b4175805765067e81538ed8367d6edbc23ae3c2f7fba53fa5e83ebe3f8aea504",
  "receipt": {
    "payee": "0xd6fce15298fc9d60f867d9455d497177da9bfb0a",
    "url": "https://x402.tbs-digital.com/weather/current",
    "terms_hash": "7a3502dc8ef0bc354c115fe96ed0b3e92eb8cab44e4d9f8371f221cd1950adda",
    "price": 0.001,
    "band": "ALLOW",
    "score": 86.43,
    "vow_fired": null,
    "evidence": [
      { "signal": "tx_count", "quote": "416 inbound + 0 outbound transfers in window" },
      { "signal": "distinct_payers", "quote": "101 distinct inbound senders, 416 inbound transfers" }
    ],
    "model": { "verdict": "ALLOW", "extractor": "dolphin", "degraded": false },
    "snapshot_id": "1b8e0086137301b94830e75405844267593d75cb5695ee83a6c2bdf2927180cc",
    "checked_at": "2026-11-10T07:00:53.959Z",
    "settlement": "dry-run",
    "enrichment": { "status": "complete", "reason": null },
    "chain": "eip155:8453",
    "prev_hash": "a15e6048e6d4780cefa285c278ee1905c2ca36dc85ee40b2dd1a520356bd0c7b",
    "receipt_hash": "b4175805765067e81538ed8367d6edbc23ae3c2f7fba53fa5e83ebe3f8aea504"
  },
  "ms": 10
}
```

| field | meaning |
|---|---|
| `mode` | Which providers produced the answer: `live`, `fixture` (recorded replies replayed) or `mock`. |
| `band` | The final verdict: `ALLOW`, `REVIEW` or `BLOCK`. |
| `score` | The 0 to 100 score before the vows. |
| `vow_fired` | The most severe vow that fired, or `null`. `vows` lists every vow that fired, with its reason. |
| `model.serv` | What the model advised. `model.degraded` is `true` when the model failed or its answer was rejected; the band is then REVIEW at best. |
| `enrichment` | Whether the optional identity extraction finished. `incomplete` never lowers the band. |
| `in_census` | Whether the payee is in the census. |
| `sku`, `cold` | `cached` ($0.05) when Fiangshi already holds on-chain signals for the payee: it is in the census, or was fetched cold in the last 72 hours. `cold` ($0.15) otherwise: two live on-chain queries for that one address. `cold` says where the signals came from, or why they could not be fetched (`budget_guard`, `surf_error`, `network_not_base`, `unavailable`); without them the answer is REVIEW. |
| `probe` | The live price and payee read from the endpoint's own 402. |
| `cost_usd`, `payer`, `settlement` | What the check cost, the wallet in your payment header, and `dry-run`. |
| `model_calls` | Live model calls made for this answer. `0` means the advice came from cache. |
| `receipt_id`, `receipt` | The sealed receipt and its id. |

### 3. Act on the band

| band | what it means | what an agent should do |
|---|---|---|
| ALLOW | Every fixed check passed and the model raised no objection. | Pay within its normal limits. |
| REVIEW | Something is missing, uncertain or unverified. | Ask a human, or cap the amount. |
| BLOCK | A vow fired, or the score is under 50. The reason is always machine-checkable. | Do not pay. |

Fiangshi never pays, refuses or reverses a payment itself. The band is advice; the decision is yours.

### 4. Verify the receipt later

```bash
curl "http://127.0.0.1:8787/v1/verify?id=b4175805765067e81538ed8367d6edbc23ae3c2f7fba53fa5e83ebe3f8aea504"
```

```json verify
{
  "mode": "live",
  "id": "b4175805765067e81538ed8367d6edbc23ae3c2f7fba53fa5e83ebe3f8aea504",
  "valid": true,
  "errors": [],
  "chain": "ledger #1"
}
```

You can also send a receipt you hold: `/v1/verify?receipt=` followed by the base64url encoding of the receipt JSON. Change one byte of it and `valid` becomes `false`.

## How a verdict is made

1. **Probe.** One unpaid GET to the endpoint. Fiangshi parses the 402 terms from the body or the `payment-required` header and hashes them (`terms_hash`).
2. **Gate.** The null-payee vow runs on the payment address straight away. A dead-end address is a BLOCK at $0.00.
3. **Score.** Six components, each between 0 and 1, from cached on-chain signals about the payee.
4. **Model.** SERV reads the terms, the signals and the score, and advises a band. Every quote it cites must be an exact piece of the stored evidence, or its answer is rejected.
5. **Vows.** Six fixed rules run last. They can lower the band and never raise it.
6. **Receipt.** The verdict and evidence are sealed with a sha256 hash and chained to the receipt before.

The final band is the lowest of three: the score's band, the model's band and the vows' band.

### The score

`score = 25M + 20P + 20R + 15I + 10E + 10C`, then 80 or more is ALLOW, 50 to 79 is REVIEW and under 50 is BLOCK.

| part | weight | what it measures |
|---|---|---|
| M, maturity | 25 | How old the wallet is and how many transfers it has seen, on log scales. |
| P, provenance | 20 | Who first funded the wallet: an exchange scores 1.0, a fresh or relayer funder 0.6, a funder shared with other payees 0.2, a mixer 0. |
| R, revenue | 20 | How many distinct wallets have paid it, and how many came back. |
| I, identity | 15 | Whether the listing's name is backed by something independent: the URL host, the URL path, the catalog or a wallet label. One source scores 0.5, two or more 0.75. No name, or a name nothing backs, is left out of the score entirely. |
| E, exposure | 10 | How concentrated its income is. Many payers with no dominant one scores high. |
| C, corroboration | 10 | How many of the expected evidence fields are present. |

Identity is the one optional part: leaving it out rescales the other weights, and having a name can only raise a score, never lower it.

### The six vows

| | vow | fires when | band |
|---|---|---|---|
| I | `null_payee` | The payment address is the zero address, a burn address, the token contract itself, or fails its EIP-55 checksum. Checked at probe time. | BLOCK |
| II | `age` | The payee wallet was first seen less than 48 hours ago. | BLOCK |
| III | `kinship` | The wallet that first funded the payee also first funded three or more other catalog payees. Exchanges and relayers are exempt. | BLOCK |
| IV | `history` | No one has paid the wallet yet, and it asks more than $0.50. | REVIEW |
| V | `identity` | The claimed name is contradicted by a label that names the wallet's operator. A person's handle or an exchange deposit address contradicts nothing. | BLOCK |
| VI | `silence` | A required on-chain signal is missing. | REVIEW |

### Failing closed

- A missing signal, a timeout, a broken model answer or a schema error gives REVIEW. Nothing is ALLOW by default.
- The model cannot raise a band. If it advises BLOCK, Fiangshi applies REVIEW, because a BLOCK must rest on a vow or on a score under 50.
- Bad data (negative ages, future timestamps, a wallet funding itself) is treated as missing. Data errors never BLOCK.
- A payee outside the census is fetched live (the cold check, $0.15): two on-chain queries for that one address, cached for 72 hours. If the data cannot be fetched (budget floor, a provider error, a network other than Base, or a server not running live providers), the answer is REVIEW with the reason. It is never a guess.

## Routes

| route | price | returns |
|---|---|---|
| `GET /v1/check?url=` | $0.05 cached (`FIANGSHI_PRICE_CHECK`), $0.15 cold (`FIANGSHI_PRICE_CHECK_COLD`) | The verdict above. A null payee answers BLOCK for free. The 402 quotes the price that applies. |
| `GET /v1/payee/:address` | $0.02 by default (`FIANGSHI_PRICE_PAYEE`) | The census record for one payee: band, score, vows fired, listing name and how it was corroborated, first funder, receipt id. |
| `GET /v1/index.json` | free | Every census payee: address, example endpoint, band, score, vows fired, receipt id. |
| `GET /v1/receipt/:id` | free | One receipt as JSON. |
| `GET /v1/verify?id=` or `?receipt=` | free | Recomputes the hash and the chain link. |
| `GET /v1/badge/:address.svg` | free | A small badge coloured by band. |
| `GET /health` | free | Liveness, census size and time. |

The pages `/`, `/check?url=` and `/receipt/:id` show the same free data for people.

## Receipts

| field | meaning |
|---|---|
| `payee`, `url`, `price` | The wallet that would be paid, the endpoint checked and the price it asked, in USD. |
| `terms_hash` | sha256 of the payment terms as probed. |
| `band`, `score`, `vow_fired` | The verdict. |
| `evidence` | The quotes the verdict rests on, each tied to a named signal. |
| `model` | What the model advised, which extractor ran, and whether the model was degraded. |
| `enrichment` | Optional. The status of identity extraction and, if incomplete, why. |
| `snapshot_id` | Which data snapshot the signals came from. |
| `checked_at`, `settlement` | When the check ran, and `dry-run`. |
| `chain` | `eip155:8453` (Base). Fiangshi is Base only; the field keeps a Base address from ever being confused with the same address on another chain. |
| `prev_hash`, `receipt_hash` | The id of the receipt before this one, and this receipt's own id. |

`receipt_hash` is the sha256 of the canonical JSON of every other field. Receipts are hash-chained, not signed: there is no signing key. Tampering with a receipt, removing one or reordering them breaks verification.

## Limits

- **A 90-day window.** Wallet age is a lower bound: first seen within the last 90 days.
- **Unnamed funders.** Most shared funders have no public label. A kinship BLOCK means "these payees share one funder that could not be named", which is an upper bound on real kinship: an unnamed funder may still be an exchange.
- **Thin labels.** Few wallets carry a public label. A missing or unverified name is scored as neutral, not as trust and not as a penalty.
- **The census is a sample.** Coverage and band counts are on the front page and in `/v1/index.json`.
- **Dry-run settlement.** No payment is verified or settled in this build.

## Run it yourself

```bash
cp .env.example .env
npm ci
npm test
npm run accept
npm run localhost-check
npm run dev
```

All of this works with no keys. By default the server runs in fixture mode: recorded 402s and recorded model replies are replayed through the real parser, vows and receipt chain, and every response says `"mode": "fixture"`. For live providers, add `SERV_REASONING_API_KEY` to `.env`, set `FIANGSHI_REPLAY=0`, `FIANGSHI_OFFLINE=0` and `MOCK_MODELS=`, and run `npm run localhost-check -- --live`.

Before running an instance for other people, set `FIANGSHI_PAYTO` (your own wallet) and `FIANGSHI_CONTACT` (how sellers and users can reach you). See [Legal](LEGAL.md).
