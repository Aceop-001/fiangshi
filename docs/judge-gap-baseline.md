# Judge-gap baseline

Measured 2026-11-19T02:55:49Z against the live API (policy 2026-11-13.5, commit d76a3c0). Raw output, unedited.

## 1

```bash
curl -s 'https://api.fiangshi.xyz/v1/preview?url=https://openserv.ai'
```

```json
{
  "mode": "live",
  "url": "https://openserv.ai",
  "verdict": "no_verdict",
  "vow_fired": null,
  "vows_fired": [],
  "score": null,
  "reason": "probe failed: status 308, expected 402",
  "source": "unpaid probe of the endpoint",
  "terms": null,
  "cost_usd": 0,
  "receipt_id": null,
  "data_as_of": null,
  "data_age_hours": null,
  "stale": null,
  "paid_check": "https://api.fiangshi.xyz/v1/check?url=https%3A%2F%2Fopenserv.ai",
  "paid_check_status": "enabled: x402 payment in USDC on Base (eip155:8453), $0.05 for a census payee, $0.15 for a cold lookup; settlement is dry-run",
  "unknowns": [
    "who would be paid: the endpoint did not return usable x402 payment terms"
  ],
  "issued_band": null,
  "band_cap": null,
  "verdict_confidence": null,
  "policy_version": "2026-11-13.5"
}
```

## 2

```bash
curl -s 'https://api.fiangshi.xyz/v1/preview?url=https://platform.openserv.ai/workspace/paywall/3e29e985a'
```

```json
{
  "mode": "live",
  "url": "https://platform.openserv.ai/workspace/paywall/3e29e985a",
  "verdict": "no_verdict",
  "vow_fired": null,
  "vows_fired": [],
  "score": null,
  "reason": "probe failed: status 200, expected 402",
  "source": "unpaid probe of the endpoint",
  "terms": null,
  "cost_usd": 0,
  "receipt_id": null,
  "data_as_of": null,
  "data_age_hours": null,
  "stale": null,
  "paid_check": "https://api.fiangshi.xyz/v1/check?url=https%3A%2F%2Fplatform.openserv.ai%2Fworkspace%2Fpaywall%2F3e29e985a",
  "paid_check_status": "enabled: x402 payment in USDC on Base (eip155:8453), $0.05 for a census payee, $0.15 for a cold lookup; settlement is dry-run",
  "unknowns": [
    "who would be paid: the endpoint did not return usable x402 payment terms"
  ],
  "issued_band": null,
  "band_cap": null,
  "verdict_confidence": null,
  "policy_version": "2026-11-13.5"
}
```

## 3

```bash
curl -s 'https://api.fiangshi.xyz/v1/preview?url=https%3A%2F%2Fapi.fiangshi.xyz%2Fv1%2Fcheck%3Furl%3Dhttps%3A%2F%2Fopenserv.ai'
```

```json
{
  "mode": "live",
  "url": "https://api.fiangshi.xyz/v1/check?url=https://openserv.ai",
  "verdict": "no_record",
  "vow_fired": null,
  "vows_fired": [],
  "score": null,
  "reason": "Fiangshi holds no on-chain signals for this payee yet. The paid check fetches them (cold check). Never treat no_record as ALLOW.",
  "source": "payee not in the census",
  "terms": {
    "price_usd": 0.05,
    "network": "base",
    "asset": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "pay_to": "0x0FdEe24dbc6EDCa4316312C7461658F4A26e6007",
    "terms_hash": "42c769b7dbd6513847bb0cc96dd16f224b03ed4378b24d72475974b3add37b5f"
  },
  "cost_usd": 0,
  "receipt_id": null,
  "data_as_of": null,
  "data_age_hours": null,
  "stale": null,
  "paid_check": "https://api.fiangshi.xyz/v1/check?url=https%3A%2F%2Fapi.fiangshi.xyz%2Fv1%2Fcheck%3Furl%3Dhttps%3A%2F%2Fopenserv.ai",
  "paid_check_status": "enabled: x402 payment in USDC on Base (eip155:8453), $0.05 for a census payee, $0.15 for a cold lookup; settlement is dry-run",
  "unknowns": [
    "everything about this wallet: it is not among the 1923 census payees"
  ],
  "issued_band": null,
  "band_cap": null,
  "verdict_confidence": null,
  "policy_version": "2026-11-13.5"
}
```

## What the targets themselves return (unpaid)

| target | status | note |
|---|---|---|
| `https://openserv.ai` | 308 → `https://www.openserv.ai/` | a website, not a paid endpoint |
| `https://platform.openserv.ai/workspace/paywall/3e29e985a` | 200 text/html | a 3.8 KB client-rendered page; the id is truncated (real ids are 32 hex) |
| `https://api.fiangshi.xyz/v1/check?url=https://openserv.ai` | 402, terms parsed | payTo `0x0FdEe24dbc6EDCa4316312C7461658F4A26e6007` is not in the 1,923-payee census |

## OpenServ marketplace (`GET https://api.openserv.ai/x402-services`)

- 151 services, 62 with `isActive: true`. Item fields: `id, name, description, x402Pricing, inputSchema, paywallUrl, webhookUrl, workspaceName, ownerDisplayName, isActive, createdAt`.
- No field carries a payee wallet; the listing contains no 0x address at all.
- `paywallUrl` (platform.openserv.ai) serves a client-rendered app shell: no JSON-LD, no `__NEXT_DATA__`, no OpenGraph price, no 0x address in the server HTML.
- `webhookUrl` (api.openserv.ai/webhooks/x402/trigger/<id>): `GET` → 404; `POST {}` → 400 `buyerAddress: Required`. Neither answers 402 with x402 terms.
