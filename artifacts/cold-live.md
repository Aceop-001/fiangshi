# One live cold check

Run with `npx tsx scripts/cold-live.ts` on 2026-11-11 against https://api.bitrefill.com/x402/gift-cards/search, a real Base payee (0x480cd46e…) that is not in the 800-payee census. The server ran with live providers; settlement stayed dry-run. Output, verbatim:

```
402 asks 0.15 USDC (cold SKU)
cold:   band ALLOW score 86.36 vow none | sku cold | cold {"ok":true,"source":"surf","surf_calls":2,"credits_before":1056,"credits_after":1048,"fetched_at":"2026-11-11T02:36:11.695Z"} | 10772 ms | receipt c312ce9be94e18fbdf87e0eb766cde88d909f9229aa8f6bde72cf49ca3f06010
        credits 1056 -> 1048 (spent 8)
repeat: 402 asks 0.05 USDC | band ALLOW | sku cached | cold source cache surf_calls 0 | 237 ms | receipt c12d7af93219fc960db9b2480ea4584b78f1ac0d24abcebfbb2e6ab486164766
        credits 1048 -> 1048 (spent 0)
```

The two Surf calls are rows 93 and 94 of the budget ledger in `artifacts/costs.md` (2026-11-11T02:36). Surf's `meta.credits_used` reported 5 per call; the balance fell by 4 per call. The receipts are in the local ledger (`data/ledger.jsonl`, not committed). Running the script again within 72 hours makes no Surf call.
