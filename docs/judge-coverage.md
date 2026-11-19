# Judge coverage

Post-deadline work (branch `post-deadline/coverage`). The judged entry is commit `59b4712` as of 15 Nov 23:59 UTC.

Measured 2026-11-19T10:09:13Z by `npx tsx scripts/judge-coverage.ts`: this branch's server in live mode, asked `GET /v1/preview` for each of the 38 hackathon endpoints in `fixtures/judge/endpoints-38.txt`. Free route only: no payment, no model call, no Surf call. Results depend on the endpoints at that moment.

## Summary

| class | endpoints |
|---|---|
| `VERDICT` | 0 |
| `NO_RECORD` | 0 |
| `PAYMENT_TERMS_UNPARSEABLE` | 1 |
| `UNVERIFIED_ENDPOINT` | 37 |
| bare probe failure (no class) | 0 |

Target: every endpoint gets a structured record. Met: 38 of 38.

## Not done on this branch

- **Census self-coverage (workstream D):** skipped. The service's own payTo is not in the census; adding it needs fresh Surf credits. It is reported separately instead, from Base logs with no Surf call: the `self_coverage` block of `/v1/index.json` (`scripts/self-coverage.ts`, `fixtures/self-coverage.json`).
- **OpenServ marketplace (workstream C):** skipped. None of the 151 listings at `https://api.openserv.ai/x402-services` names a payee wallet (see `docs/judge-gap-baseline.md`).

## Every endpoint

| endpoint | class | status chain | final host | terms | TLS | reason |
|---|---|---|---|---|---|---|
| https://fiangshi.xyz | `UNVERIFIED_ENDPOINT` | 200 | fiangshi.xyz | absent | true | probe failed: not an x402 endpoint as given: 200 at fiangshi.xyz (text/html), no machine-readable payment terms |
| https://heist-khaki.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | heist-khaki.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at heist-khaki.vercel.app (text/html), no machine-readable payment terms |
| https://thuli-drop.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | thuli-drop.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at thuli-drop.vercel.app (text/html), no machine-readable payment terms |
| https://teger-agent.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | teger-agent.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at teger-agent.vercel.app (text/html), no machine-readable payment terms |
| https://cheap-first.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | cheap-first.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at cheap-first.vercel.app (text/html), no machine-readable payment terms |
| https://viandra.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | viandra.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at viandra.vercel.app (text/html), no machine-readable payment terms |
| https://tare-agent.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | tare-agent.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at tare-agent.vercel.app (text/html), no machine-readable payment terms |
| https://watchdog-reppo.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | watchdog-reppo.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at watchdog-reppo.vercel.app (text/html), no machine-readable payment terms |
| https://basanos-nu.vercel.app/ | `UNVERIFIED_ENDPOINT` | 200 | basanos-nu.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at basanos-nu.vercel.app (text/html), no machine-readable payment terms |
| https://robd-hub.github.io/agent-report-card/ | `UNVERIFIED_ENDPOINT` | 200 | robd-hub.github.io | absent | true | probe failed: not an x402 endpoint as given: 200 at robd-hub.github.io (text/html), no machine-readable payment terms |
| https://bonded-pool.onrender.com | `UNVERIFIED_ENDPOINT` | 200 | bonded-pool.onrender.com | absent | true | probe failed: not an x402 endpoint as given: 200 at bonded-pool.onrender.com (text/html), no machine-readable payment terms |
| https://calebcreationz.github.io/downshift | `UNVERIFIED_ENDPOINT` | 301 → 200 | calebcreationz.github.io | absent | true | probe failed: not an x402 endpoint as given: 301 → 200 at calebcreationz.github.io (text/html), no machine-readable payment terms |
| https://trybrokro.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | trybrokro.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at trybrokro.vercel.app (text/html), no machine-readable payment terms |
| https://greenlight-gate.netlify.app/ | `UNVERIFIED_ENDPOINT` | 200 | greenlight-gate.netlify.app | absent | true | probe failed: not an x402 endpoint as given: 200 at greenlight-gate.netlify.app (text/html), no machine-readable payment terms |
| https://na-income.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | na-income.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at na-income.vercel.app (text/html), no machine-readable payment terms |
| https://capsule-phi-blond.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | capsule-phi-blond.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at capsule-phi-blond.vercel.app (text/html), no machine-readable payment terms |
| https://upfront-terms.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | upfront-terms.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at upfront-terms.vercel.app (text/html), no machine-readable payment terms |
| https://khanhtnq.github.io/openserv-kite-x402-sentinel/ | `UNVERIFIED_ENDPOINT` | 200 | khanhtnq.github.io | absent | true | probe failed: not an x402 endpoint as given: 200 at khanhtnq.github.io (text/html), no machine-readable payment terms |
| https://errand-pearl.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | errand-pearl.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at errand-pearl.vercel.app (text/html), no machine-readable payment terms |
| https://jusst01.github.io/alpha-desk/ | `UNVERIFIED_ENDPOINT` | 200 | jusst01.github.io | absent | true | probe failed: not an x402 endpoint as given: 200 at jusst01.github.io (text/html), no machine-readable payment terms |
| https://tranche-serv.fly.dev | `UNVERIFIED_ENDPOINT` | 200 | tranche-serv.fly.dev | absent | true | probe failed: not an x402 endpoint as given: 200 at tranche-serv.fly.dev (text/html), no machine-readable payment terms |
| https://bluff-forge.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | bluff-forge.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at bluff-forge.vercel.app (text/html), no machine-readable payment terms |
| https://tripwirev1.up.railway.app | `UNVERIFIED_ENDPOINT` | 200 | tripwirev1.up.railway.app | absent | true | probe failed: not an x402 endpoint as given: 200 at tripwirev1.up.railway.app (text/html), no machine-readable payment terms |
| https://agentshield-lac-one.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | agentshield-lac-one.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at agentshield-lac-one.vercel.app (text/html), no machine-readable payment terms |
| https://evalloop-1458.fly.dev | `UNVERIFIED_ENDPOINT` | fetch failed: ECONNRESET |  |  | null | probe failed: unreachable: fetch failed: ECONNRESET |
| https://automationbot24x7.github.io/spendgrade/ | `UNVERIFIED_ENDPOINT` | 200 | automationbot24x7.github.io | absent | true | probe failed: not an x402 endpoint as given: 200 at automationbot24x7.github.io (text/html), no machine-readable payment terms |
| https://reins-zeta.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | reins-zeta.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at reins-zeta.vercel.app (text/html), no machine-readable payment terms |
| https://frontend-mocha-chi-59.vercel.app/desk | `UNVERIFIED_ENDPOINT` | 200 | frontend-mocha-chi-59.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at frontend-mocha-chi-59.vercel.app (text/html), no machine-readable payment terms |
| https://pawlr.vercel.app/ | `UNVERIFIED_ENDPOINT` | 200 | pawlr.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at pawlr.vercel.app (text/html), no machine-readable payment terms |
| https://proofpilot-ai-xxj8.onrender.com | `UNVERIFIED_ENDPOINT` | timeout |  |  | true | probe failed: unreachable: timeout |
| https://quoteseal.ozc.fr | `UNVERIFIED_ENDPOINT` | 200 | quoteseal.ozc.fr | absent | true | probe failed: not an x402 endpoint as given: 200 at quoteseal.ozc.fr (text/html), no machine-readable payment terms |
| https://devils-advocate-hazel.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | devils-advocate-hazel.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at devils-advocate-hazel.vercel.app (text/html), no machine-readable payment terms |
| https://hiremind-orpin.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | hiremind-orpin.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at hiremind-orpin.vercel.app (text/html), no machine-readable payment terms |
| https://lotvale.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | lotvale.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at lotvale.vercel.app (text/html), no machine-readable payment terms |
| https://centiv-gilt.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | centiv-gilt.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at centiv-gilt.vercel.app (text/html), no machine-readable payment terms |
| https://bribot.onrender.com | `UNVERIFIED_ENDPOINT` | 200 | bribot.onrender.com | absent | true | probe failed: not an x402 endpoint as given: 200 at bribot.onrender.com (text/html), no machine-readable payment terms |
| https://brih-mu.vercel.app | `UNVERIFIED_ENDPOINT` | 200 | brih-mu.vercel.app | absent | true | probe failed: not an x402 endpoint as given: 200 at brih-mu.vercel.app (text/html), no machine-readable payment terms |
| https://repay-ready.vercel.app | `PAYMENT_TERMS_UNPARSEABLE` |  |  |  |  | probe failed: host-level 402 from Vercel (DEPLOYMENT_DISABLED): the hosting platform is refusing the deployment; this is not an x402 offer |
