# Local Testing Prompt — LOCAL VERIFICATION MODE

Nothing here touches the network.

## Fixtures first
Record, once, into fixtures/:
- `fixtures/402/*.json` : 10 real unpaid responses (raw status + headers + body)
- `fixtures/payees.json` : payee facts shaped exactly like PayeeSignals
- `fixtures/model/*.json`: 3 SERV outputs — 1 good, 1 with a hallucinated signal name, 1 with a quote that is not a substring of the evidence

Adapters replay fixtures when `FIANGSHI_OFFLINE=1` or `SNAPSHOT_SOURCE=fixture`. Mocks live ONLY at adapter boundaries — core/ must never know about them.

## Deliver `npm run accept`
Runs the 10 gates below, prints PASS/FAIL per line, exits non-zero on any FAIL, makes zero network calls, finishes <20s.

| gate | check |
|---|---|
| G1 | typecheck clean |
| G2 | npm test green (30+ cases, no network) |
| G3 | probe parses 10/10 fixtures |
| G4 | fixture snapshot stable snapshot_id x2 |
| G5 | check offline <300ms |
| G6 | vow beats model ALLOW |
| G7 | receipt verify + tamper detection |
| G8 | MOCK_MODELS=broken -> REVIEW, degraded=true |
| G9 | budget guard refuses call N+1 |
| G10 | index builds, lists >=25 payees, no JS |

## `fiangshi check --explain`
Print every signal and value, each score component with its weight and contribution, the vow table with pass/fire, the model's citations with the substring check result, and the final band. This is the debugger — I must be able to reason without spending a credit.

## tests/contract.test.ts
Every zod schema round-trips a fixture, and a missing required field produces REVIEW, never a crash and never ALLOW.

## tests/adversarial.test.ts
Hand-written attacks on your own logic — future timestamp, payee that is the funder itself, quote with trailing whitespace, empty evidence map, duplicate payees in the catalog, price "0", negative age. Expected result is written in the test name.

Report a table at the end of this phase: gate | result | duration | notes. Do not proceed to API wiring until all 10 are green.
