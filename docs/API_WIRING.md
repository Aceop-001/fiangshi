# API Connection Prompt — discovery first, one smoke test per provider, everything capped

Read this whole block before writing code. Do not guess endpoints or models.

## GLOBAL RULES
- All keys from .env only. Never log a key. Never echo it in errors.
- `scripts/budget.ts` wraps every outbound data call: increments a counter file, records reported credit/usage when present, refuses past the cap, appends a line to artifacts/costs.md.
- `scripts/smoke.ts` takes a provider argument and prints: provider, endpoint, latency, units consumed, verdict. Run it once per provider, save output.
- Any 429/5xx: back off once, then fail the smoke with a clear message. Never retry in a loop.

## A. SURF (on-chain + social data; CLI, credit-metered)
Discover, never assume:
```
surf list-operations | grep -E "onchain|wallet|token|search|x-tweets"
surf --help            # copy flags and enums verbatim
surf onchain-sql --help  # POST: JSON on stdin
```
Call pattern for the snapshot (the ONLY expensive path):
- Build ONE JSON payload per metric with the deduped payee list (e.g. `{"sql":"... WHERE payee IN (...) ..."}`) and pipe it in.
- Read `meta.credits_used` from the response and log it.
- Write results to data/snapshot.json; never re-query the same payee set.
- Forbidden: `for (const p of payees) await surf(...)`. If you catch yourself writing that, replace it with a batch or stop and ask.
- Smoke: one 2-payee query, print credits_used. Cap the whole project at FIANGSHI_MAX_SURF_CALLS=60 and expect the audit to need <=10.

## B. SERV REASONING (verdict model)
- Client: OpenAI-compatible. baseURL from SERV_BASE_URL (default https://inference-api.openserv.ai/v1), key SERV_REASONING_API_KEY.
- Discover the model id from the provider's /models endpoint (or docs) and put it in SERV_MODEL, never inline.
- temperature 0, tight max_tokens, one call per (payee, terms_hash) cached on disk.
- Validate, in order: JSON parses -> band present -> every citation.signal exists in the input -> every citation.quote is a substring of that signal's evidence. Then apply Vows.
- Fallback: deterministic verdict, degraded=true, one WARN line.
- Smoke: 3 fixture signals -> expect 3 valid verdicts, print tokens used.

## C. DOLPHIN (identity extraction only)
- Read the provider's docs (dphn.ai) before coding; put base URL and model in DOLPHIN_BASE_URL / DOLPHIN_MODEL — if you cannot confirm them, STOP and ask me.
- Scope: text in, typed fields out ({claims_org, claims_product, claims_age_claim}). No verdict authority, no scoring.
- Hash every input string, cache forever.
- Smoke: one seller bio -> fields + cache hit on second run (0 new calls).

## D. KITE AGENT PASSPORT (payments; seller side)
- Read https://docs.gokite.ai/passport/seller and https://agentpassport.ai/quickstart before writing adapters/x402.ts.
- Install and verify: `curl -fsSL https://agentpassport.ai/install.sh | bash ; kpass --version`  (user runs this — not the agent)
- Seller flow: return 402 with terms -> agent resends with X-Payment header -> verify -> settle via KITE_FACILITATOR_URL -> deliver the verdict.
- Session limits: per-tx cap, total budget, TTL, asset allowlist. Configure the smallest possible session for testing (per-tx $0.01, total $0.10, TTL 1h).
- Smoke: exactly ONE real settlement. Record tx hash, amount, receipt hash into artifacts/costs.md. Everything before that runs with settlement:"dry-run".

## E. FIXTURE FALLBACK (mandatory)
Every adapter returns fixture data when FIANGSHI_OFFLINE=1. `npm run accept` must pass with the network unplugged. Live mode is a flag, not a different code path. If live and fixture disagree in shape, fix the fixture and add a test — never special-case the code.

## ORDER OF WORK
Surf smoke -> SERV smoke -> Dolphin smoke -> fixtures locked -> adapter code -> Kite dry-run -> one real settlement -> update artifacts/costs.md and README Build Log.
Report: provider, latency, units consumed, and the one thing that surprised you in the docs.
