# Test report: from failures to green

Fiangshi decides whether an AI agent should pay a stranger, so it has to be believable when it is wrong as well as when it is right. This report keeps every failure on the record: what we saw, why it happened, what we changed, and the evidence that the change worked. Nothing here has been rewritten after the fact. A lab case written under an old rule stays visible as "superseded", not edited.

The lab history, the per-commit test and gate counts, and the last measured status at the end of this page are computed from committed files every time the page loads. Every other number on this page comes from a committed script or fixture, named next to it.

## Where things stand

| measure | value | source |
|---|---|---|
| census | 1,923 of 1,923 Base payees, 90-day window, refreshed 13 Nov (each record with its own `as_of`) | `scripts/audit.ts`, `data/numbers.json` |
| verdicts | 127 ALLOW / 1,244 REVIEW / 552 BLOCK, policy `2026-11-13.5` | `scripts/numbers.ts` |
| verdictable payees | 1,870 (97.2%) | `scripts/winrate.ts` |
| lab | 9 cases: 8 pass, 1 superseded by a documented rule change | `scripts/matrix.ts` |
| real sellers in the lab (controls) | 3 of 3 reach ALLOW | `artifacts/matrix.md` |
| accept gates | 17 of 17, offline, network unplugged | `npm run accept` |
| end to end | 10 of 10 on a local server, with no keys (fixture mode) and with keys (live) | `npm run localhost-check` |
| census cost | 620 credits billed for the 13 Nov refresh of 1,923 payees (the 9 Nov census of 800 cost 252) | `fixtures/audit/balances.json` |
| warm check | 251 ms median | `artifacts/demo-stats.json` |
| cold check | 10.8 s, 8 credits, then 237 ms from cache | `artifacts/cold-live.md` |
| paid check, live | `api.fiangshi.xyz` answers 402 (Base USDC, $0.05, paid to the operator wallet); with a test payment header: ALLOW 88.33 on Bitrefill, SERV and Dolphin both answered, 3.6 s, receipt verifies; settlement dry-run | `docs/GUIDE.md` (captured 402), `tests/guide-examples.test.ts` |
| freshness | every census record carries its own `as_of`; data older than 72 h caps ALLOW at REVIEW (policy `2026-11-13.5`) | `artifacts/refresh.md`, gate G16 |

## How we test

There are four layers, and each one must be green before a commit.

1. **Unit and table tests** (`npm test`, vitest). Pure functions (score, rules, receipts, drift, the probe parser, the markdown renderer, translations) are tested at their edges: 0, the middle, 1, and missing. Each rule has its own table of cases, and a precedence test proves a rule beats a model ALLOW.
2. **Accept gates** (`npm run accept`). Seventeen checks run with the network blocked by a preload that refuses every connection except the local machine. They are listed in the table below.
3. **End to end** (`npm run localhost-check`). A real server on a free local port, then ten checks over HTTP: the site, the free check, a BLOCK with a receipt, the paid 402, a paid call with a test payment header, verify, tamper, the index, the badge and the timing.
4. **The adversarial lab** (`npx tsx scripts/matrix.ts`). Six attack cases and three real sellers run through the live pipeline. The expected answer for each case is committed **before** the run, and is never edited afterwards.

| gate | what it proves |
|---|---|
| G1 | the code typechecks and builds |
| G2 | every test passes with no network |
| G3 | the probe parses every recorded 402 |
| G4 | the snapshot hash is the same across two builds |
| G5 | an offline check finishes in under 300 ms |
| G6 | a rule beats a model ALLOW |
| G7 | a receipt verifies, and any edit breaks it |
| G8 | a broken model gives REVIEW, marked degraded |
| G9 | the budget guard refuses call N+1 |
| G10 | the index page builds with no script |
| G11 | the recorded real 402s are untouched and all parse |
| G12 | every document agrees with `data/numbers.json` |
| G13 | a repeated cold check makes zero Surf calls |
| G14 | the kinship thresholds hold |
| G15 | the sensitivity table matches the numbers |
| G16 | no ALLOW in the published index is past the freshness window (policy v5), at the reference time, just past the limit and long after |
| G17 | a receipt outlives the server: after a restart with the ledger deleted, the id answers 404 with a hint, the payload still verifies (band re-derived, chain link reported as unverified), and one changed byte fails |

A fifth check runs once per release: a fresh copy of the repository with no keys, then `npm ci`, `npm test`, `npm run accept` and `npm run localhost-check`. It has passed every time since 9 Nov.

## Timeline

| date | phase | what was built | commit |
|---|---|---|---|
| 8 Nov | 0 | skeleton, frozen data contracts (zod), canonical hashing | `4f15a55` |
| 8 Nov | 1–7 offline | probe, snapshot, score, rules, model check, receipts, ledger, drift | `2814c52` |
| 8 Nov | local verification | 10 offline accept gates, the no-network preload | `fbbef4b` |
| 8 Nov | 3b–3f | Surf installed and measured, 12 real 402s recorded, billing model, E v2, models wired live | `41f235c` … `c6bdf17` |
| 9 Nov | 3g–3k | paid audit gate, fixture guard (G11), staged census runner, the 800-payee census | `79cd224` … `120f116` |
| 9 Nov | 3l | rule I (null payee), keccak-256 and EIP-55 in the repo, rule set frozen at six | `b1a6ffd` |
| 9 Nov | 3m–3n | identity v3, adversarial lab with expectations committed first | `3de3cbe` … `8290a69` |
| 9 Nov | 3b-fix–3h | optional identity enrichment, API and real 402, end to end check, README, identity neutrality, fixture mode | `218e5fc` … `f693300` |
| 10 Nov | 3i–3k | the site (no script), operator-only identity labels, guide and legal pages, evidence sources | `fbf90f5` … `224ae4c` |
| 11 Nov | final A–F | kinship calibration, funder labels re-asked, cold check live, win-rate, single source of numbers (G12–G15) | `c9280f3` … `5696cd2` |
| 11–12 Nov | site | guide with real endpoints, test report, crash fix, four languages | `7628f67` … `7cfe713` |
| 13 Nov | connect | architecture page, connect guides, MCP server, free JSON preview, first-visit tour | `b511c89` … `2369a2d` |
| 13 Nov | launch | fiangshi.xyz on GitHub Pages, live API on Render, outside review fixes | `0951a07` … `4a779dd` |
| 13 Nov | policy v5 | per-record freshness and the stale cap (a band cap, not a vow) | `bb8acc9` |
| 13 Nov | refresh | paid Surf refresh of all 1,923 Base payees (620 credits) | `55d860e` |
| 13 Nov | paid route | real x402 terms in the 402, `X-PAYMENT-RESPONSE`, every figure regenerated, gate G16, the captured live 402 | `3ec5f7a` … `ffb54b4` |
| 13 Nov | durable receipts | the paid answer carries its receipt and a verify URL, honest payload verification, ledger mirror, gate G17 | this release |

The full per-commit list, with the number of test files, test cases and gates at each commit, is in the table near the end of this page.

## Every failure, in order

Each entry has the same four parts. **Seen** is what went wrong. **Cause** is why. **Fix** is what changed. **Proof** is how we know it worked.

### F1. Seven real 402s would not parse (8 Nov)

- **Seen.** 7 of the first 200 live 402 responses from the x402 catalog failed to parse.
- **Cause.** A seller that offered several payment options was rejected as a whole when any one option was in another format, even when a valid Base option sat next to it. Some sellers also put the terms only in the `payment-required` header, not in the body.
- **Fix.** Each payment option is checked on its own; the body is read first, then the x402 v2 header. v1 (`maxAmountRequired`) and v2 (`amount`, CAIP-2 network) are both accepted.
- **Proof.** 5 of the 7 now parse; the other 2 have no Base option at all. 13 recorded real 402s are parsed on every test run (G3, G11), and the raw recordings are never overwritten.

### F2. Surf billed more than it reported (8 Nov)

- **Seen.** The account balance fell faster than `meta.credits_used` said.
- **Cause.** Billing is per call by tier. A keyed SQL query costs 4 credits while the reply says 5; a keyed label call costs 4 while the reply says 1. Refused queries and queries killed at the timeout are billed too, with no rows.
- **Fix.** Spend is measured from the balance before and after, never from the reply. Every call goes through a budget guard. A failed address set is split in half and never sent again. Label calls are capped at 20 addresses, because 50 or more fail with `INTERNAL_ERROR`.
- **Proof.** The 800-payee census finished inside its budget; every balance reading is in `fixtures/audit/balances.json`. G9 proves the guard refuses call N+1.

### F3. The first unattended run wasted credits (9 Nov)

- **Seen.** One query with 100 payees took 34 s. The next call was refused with `SQL_QUERY_IN_FLIGHT`, and 5 credits bought nothing.
- **Cause.** The sync endpoint has a 30 s limit, and a query that runs over keeps running on Surf's side.
- **Fix.** The runner saves a checkpoint after every query, stops on a 24 s gate and on any refusal without retrying, and uses batches of 50.
- **Proof.** Every later batch resumed cleanly from its checkpoint, with no batch sent twice.

### F4. An async scan was refused for size (9 Nov)

- **Seen.** A funder query over 300 addresses was refused: about 141 million rows to scan. It was billed 4 credits.
- **Cause.** The async job has a scan budget, and funder outbound transfers are huge for exchange wallets.
- **Fix.** The funder pass was split, and the refusal recorded as a billed cost.
- **Proof.** `artifacts/costs.md`, row dated 2026-11-09T02:58:44Z.

### F5. Dolphin returned empty answers (9 Nov)

- **Seen.** The identity extractor came back with nothing.
- **Cause.** The model spent its whole 200-token allowance on reasoning and was cut off before answering (`finish_reason=length`).
- **Fix.** The cap went to 1,024 tokens, and an empty answer fails closed.
- **Proof.** Identity extraction works when Dolphin answers in time; a truncated answer is stamped `enrichment: incomplete` (lab case C1).

### F6. The best score belonged to a dead end (9 Nov)

- **Seen.** The highest score in the census, 80.9 (ALLOW), was an endpoint whose payTo is the zero address. Money sent there is gone.
- **Cause.** No rule looked at the payment address itself, and the zero address has a long, busy history.
- **Fix.** A sixth rule, null payee, runs at probe time: zero address, burn address, token contract or failed EIP-55 checksum gives BLOCK before any data or model call, at $0.00, with a sealed receipt. keccak-256 and EIP-55 are written in the repository, with no new dependency.
- **Proof.** `api.cleave.fi/x402/gas` is blocked for $0.00 with zero model calls (lab B5, the guide's live example, the MCP test).

### F7. The first lab run passed 3 of 9 (9 Nov)

- **Seen.** All three real sellers came back REVIEW instead of ALLOW. The burner case (B1) and the sleeper case (B3) never reached the rule they were written for.
- **Cause.** The slow Dolphin model timed out, and a failed optional step was capping the verdict. A never-funded wallet has no age to judge, so it lands on silence, not age. No real sleeper exists in the census, and the synthetic one has payers, so the history rule cannot fire.
- **Fix.** Identity extraction became optional: a timeout is stamped on the receipt and never lowers the band. B1 and B3 got alternate expected paths, with the reason written into `cases-v2.json` and committed before the re-run.
- **Proof.** The second and third lab runs passed 9 of 9.

### F8. A rule punished being examined (9 Nov)

- **Seen.** In the census, 63 sellers whose name was checked but not confirmed had zero ALLOWs, while sellers with no name at all could reach ALLOW.
- **Cause.** The identity rule gave REVIEW to an unconfirmed claim, and the identity weight scored it below no claim.
- **Fix.** Identity neutrality: an unconfirmed claim is treated exactly like no claim. The identity rule fires only when a claim is contradicted.
- **Proof.** Lab case B4 (written under the old rule) now gets REVIEW with no rule fired. It was first recorded as a FAILURE, then marked superseded in `fixtures/lab/supersessions.json`. Its expectation was never edited.

### F9. A commit went in while a gate was red (9 Nov)

- **Seen.** Commit `2346072` was made while G2 was failing.
- **Cause.** The no-network preload blocked the tests' own local server, and the commit step did not check the exit code.
- **Fix.** The preload allows only the local machine (127.0.0.1, ::1). Every commit is now gated on the exit code of every gate.
- **Proof.** Fixed in the next commit, `7721601`. No red commit since.

### F10. The end-to-end check failed for reasons outside the code (9 Nov)

- **Seen.** Two failures: a timing check, and a test that behaved differently on the developer machine.
- **Cause.** The timing check had too little slack under load. Settings from `.env` (including keys) were leaking into the tests.
- **Fix.** The timing margin was widened, but kept below the sequential limit so it still catches a serial pipeline. Tests now run without the `.env` settings.
- **Proof.** 10 of 10, repeated in live and fixture mode.

### F11. A fresh copy without keys scored 8 of 10 (9 Nov)

- **Seen.** Someone who clones the repository without model keys could not get a green run.
- **Cause.** Two checks need a model answer.
- **Fix.** Fixture mode (`FIANGSHI_REPLAY=1`) replays recorded 402s and model replies through the real code, and a test proves it opens no connection except the local machine.
- **Proof.** 10 of 10 from a fresh copy with no keys.

### F12. The identity rule's only live BLOCK was wrong (10 Nov)

- **Seen.** One seller was blocked because its wallet label "contradicted" its product name.
- **Cause.** The label was a person's handle. A person running a wallet does not contradict a product name.
- **Fix.** Only a label that names the wallet's operator (an organisation) can contradict a claim. Labels naming a person are never shown on any page.
- **Proof.** That seller moved from BLOCK to REVIEW; `operatorName` in `src/core/identity.ts` has its own tests.

### F13. Receipts misnamed where evidence came from (10 Nov)

- **Seen.** Every seller name was quoted as a "surf label", even names taken from the seller's own catalog listing.
- **Cause.** One evidence template was used for every source.
- **Fix.** Evidence names its real source: `catalog listing name`, `surf label` or `claimed name`. Saved model replies are keyed by the exact evidence they saw, so changed evidence asks the model again instead of failing validation.
- **Proof.** The model now quotes "catalog listing name". The old recording is kept unused in `fixtures/recorded/serv`, because raw fixtures are never overwritten.

### F14. The first kinship softening went too far (11 Nov)

- **Seen.** Turning unlabelled big funders from BLOCK to REVIEW at 20 shared sellers moved BLOCK by 33.2%, and would have let the lab's sybil case (B2, which sits at exactly 20) through.
- **Cause.** The cutoff was one too low.
- **Fix.** The pass stopped and asked the owner. The cutoff was raised to 21, the smallest that keeps every lab detection. This still moved BLOCK by 25.9%, above the 15% limit first set; the owner accepted it, and it is documented.
- **Proof.** B2 still blocks. 120 sellers on likely exchange funders are now REVIEW with the flag `kinship_suspected_exchange`, and the 9 Nov census had 123 kinship BLOCKs. `artifacts/sensitivity.md` compares the three policies (G15).

### F15. A headline number was the reported one, not the billed one (11 Nov)

- **Seen.** The census cost was reported as 189 credits.
- **Cause.** That is what Surf's replies said; the balance shows 252.
- **Fix.** `scripts/numbers.ts` defines every headline number from committed data, and gate G12 fails the build if any document disagrees.
- **Proof.** G12 runs on every commit. This page is checked by it too.

### F16. A failing request could crash the server (12 Nov)

- **Seen.** While a page was being served, its image file was deleted, and the server process stopped with `ERR_HTTP_HEADERS_SENT`.
- **Cause.** The error handler tried to send a second header after the first had gone out, and the request promise had no catch.
- **Fix.** The error handler checks whether headers were already sent, and every request is wrapped in a catch.
- **Proof.** A test sends the failing request and then checks the server still answers.

### F17. The report showed a stale status (12 Nov)

- **Seen.** The report said "263 tests" after the count had grown.
- **Cause.** The number was typed into the page.
- **Fix.** The status section is computed from `artifacts/demo-stats.json` and carries its measurement date ("Last measured status").
- **Proof.** The section at the end of this page.

### F18. The MCP server could not use fetch in tests (13 Nov)

- **Seen.** Planned at design time: the accept preload denies `fetch` even to the local machine.
- **Cause.** The preload blocks the global fetch to guarantee no outside calls.
- **Fix.** The MCP server uses `node:http` and `node:https` directly.
- **Proof.** `tests/mcp.test.ts` spawns the MCP server as a real process against a test server and runs a full handshake, a tool list and a BLOCK.

### F19. The refresh would not start, twice, and nothing was billed (13 Nov)

- **Seen.** The first two starts of the paid refresh stopped before any Surf call: once on the offline switch in `.env`, once on the budget guard's 60-call ceiling (94 calls were already logged). Before that, Surf rejected the first API key the owner entered.
- **Cause.** Guards working as designed: the offline switch refuses every live call, the call ceiling counts every Surf call ever made, and the key check is a free balance read.
- **Fix.** Both switches were lifted for that run only, on the command line, with the credit floor (2,048 − 620 = 1,428) as the real cap. The owner entered a fresh key. A same-day resume now reuses any passing gate instead of paying for a new one.
- **Proof.** Balance 2,048 before and after the three false starts. The run then stopped exactly at the floor: 620 credits, 0 refusals (`fixtures/audit/balances.json`).

### F20. A moving window turned well-known sellers away from ALLOW (13 Nov)

- **Seen.** After the refresh, Nansen, Glassnode and TBS no longer answered ALLOW; kinship fired on 743 of 1,923 payees, against 243 of 800 on 9 Nov.
- **Cause.** For a wallet older than the 90-day window, the first sender inside the window stands in for its funder. The window moved four days, and that sender changed for 164 of the 800 original payees, often to a relayer-like wallet that many sellers share and Surf cannot name. Half of the 92 new kinship cases come from that, half from the full catalog putting more payees on the same funder.
- **Fix.** None to the rules: changing how the funder is read is a rubric change, which was ruled out for this pass. The effect is measured and published instead, with an upper bound.
- **Proof.** `artifacts/refresh.md` (movement table and cause split), `artifacts/sensitivity.md` (policy C), README limits. Old receipts keep their bands: the 9 Nov TBS receipt still verifies as ALLOW under v4.

### F21. Tests assumed one census and one clock (13 Nov)

- **Seen.** 12 tests failed after the refresh: hard-coded counts (800), guide examples whose bands moved, and recorded model replies that no longer matched their inputs.
- **Cause.** Facts about the 9 Nov census were written into tests, and fixture mode replays SERV answers recorded against that census.
- **Fix.** Tests read the census they test. Fixture mode serves the recorded 9 Nov census at its recorded moment (`FIXTURE_TIME`); the live path serves the refresh. The guide's examples were re-chosen from the refreshed census, and a test checks every fact they state.
- **Proof.** 346 tests, accept 16/16, localhost-check 10/10, and the same on a fresh clone with no keys.

### F22. The live paid check answered REVIEW for a clean seller (13 Nov)

- **Seen.** With the wallet set, a test payment for Bitrefill (score 88.33, no rule fired) came back REVIEW, `degraded: true`.
- **Cause.** The server had no SERV key at first, then no `SERV_MODEL`; the adapter needs both. A model that cannot answer fails closed at REVIEW, by design.
- **Fix.** The owner set `SERV_REASONING_API_KEY`, `SERV_MODEL`, and the Dolphin settings on Render.
- **Proof.** The same test payment then answered ALLOW: SERV said ALLOW, Dolphin enrichment complete, 3.6 s, receipt `2a0c6b75…7bf0` verifies with `band_matches: true`.

### F23. Two guide examples only answered POST (13 Nov)

- **Seen.** After the refresh, the guide's new Exa and HivemindOS examples gave `no_verdict` on the live site: their endpoints answer 404 and 405 to a GET and 402 only to a POST.
- **Cause.** They were chosen from the census by score and payers alone; nobody probed them. Fiangshi's probe is one unpaid GET.
- **Fix.** Replaced by ApiToll Crypto Prices (ALLOW) and Earthquake Intelligence (kinship BLOCK, a funder shared with 20 others), both chosen only after a live GET returned 402.
- **Proof.** All six guide endpoints answer through `api.fiangshi.xyz/v1/preview` with the band the guide states; `tests/guide-examples.test.ts` checks every stated fact against the census.

### F24. A paid receipt died with the server (13 Nov)

- **Seen.** An outside review asked for a receipt issued two hours earlier by id: 404, because the live ledger on Render's free tier is wiped on redeploy. The paid answer did not hand back anything durable to keep, and `?receipt=` answered as if the chain link had been checked.
- **Cause.** The ledger was the only copy, and payload verification reused the wording of a ledger lookup.
- **Fix.** The paid answer now carries its full receipt and a `receipt_verify_url` (also in `X-RECEIPT-VERIFY`). Verification reports `source` and `chain_linkage`, and from a payload it says plainly that the link to the previous receipt cannot be checked. A forgotten id answers 404 with a hint. An optional ledger mirror restores ids on start; export and import scripts move a ledger and refuse entries that do not link.
- **Proof.** Gate G17 restarts a server with its ledger deleted: the id answers 404, the payload verifies with `band_matches: true` and `chain_linkage: "unverified"`, and one changed byte fails. `tests/receipt-durable.test.ts` covers the rest.

## Rule changes, each one measured

Every rule change was simulated on the census before it was applied, and its effect was recorded.

| date | change | effect | file |
|---|---|---|---|
| 8 Nov | E v1 (token share) → E v2 (payer concentration) | E stops rewarding a seller for using one token | `artifacts/capability.md` |
| 9 Nov | rule I added (null payee) | the top-scored dead end is blocked | `src/core/v6.ts` |
| 9 Nov | identity v3 (corroboration by host, path, catalog or label) | simulated first, in `46c0e86` | `src/core/identity.ts` |
| 9 Nov | identity optional (timeout never caps) | lab controls reach ALLOW | `src/adapters/dolphin.ts` |
| 9 Nov | identity neutrality | examined sellers are no longer penalised | `src/core/score.ts` |
| 10 Nov | operator-only labels | one false BLOCK becomes REVIEW | `src/core/identity.ts` |
| 11 Nov | kinship v2 (REVIEW at 21+ unlabelled) | 120 BLOCK become REVIEW | `artifacts/sensitivity.md` |
| 13 Nov | policy v5: stale cap at REVIEW (a band cap, not a vow) | 0 ALLOW moved at the reference time; all 127 cap to REVIEW once their data passes 72 h | `artifacts/refresh.md` |

The rule count has been frozen at six since 9 Nov.

## Surf: what we measured about the data source

| fact | measured value | consequence |
|---|---|---|
| billing | per call, 4 credits per keyed SQL call | batch payees, never loop per payee |
| reply vs balance | SQL says 5, labels say 1, both bill 4 | trust the balance |
| sync timeout | 30 s | 24 s gate, batches of 50 |
| killed and refused calls | billed | never re-send a failed set; split it |
| label batch size | fails above about 20 addresses | at most 20 per call |
| async jobs | need an API key | free tier uses two single-branch sync queries |
| window | 365 days at most; census uses 90 | wallet age is a lower bound |
| refresh cost (13 Nov) | 0.16 credits per payee for SQL at 50 per call, 0 refusals at a 25 s limit | a full refresh of 1,923 payees fits in about 320 credits before labels |
| label coverage | 81 of 1,907 addresses returned a label row (4.2%), 42 with a name or type | most funders stay unnamed; kinship can only exempt what Surf names |

## Still failing or not done

These are open, and they are not hidden anywhere else either.

- **Most shared funders have no name.** 47 of the 49 funders behind a kinship vow have no Surf label. If they turn out to be exchanges or relayers, up to 436 of the 552 BLOCKs (79%) could be wrong. The number is published as an upper bound (`artifacts/winrate.md`).
- **The first funder of an old wallet drifts with the window** (F20). Not fixed in this pass, because it needs a rubric change.
- **The census goes stale on 16 Nov around 10:54 UTC.** After 72 hours every ALLOW serves as REVIEW until the next refresh. That is the cap working, not a fault.
- **The public API's ledger is ephemeral.** No mirror is configured on Render's free tier, so ids are forgotten on redeploy; receipts stay verifiable from their payload.
- **No real payment yet.** Settlement is a dry run until the owner pays from their own wallet. Fiangshi will not do it for them.
- **3 real control sellers in the lab, not 10.** The census only had a few sellers that pass every rule with complete data.
- **The age, history and identity rules have no live case.** They are tested on fixtures and tables only.
- **Codex, Cursor, VS Code and Gemini CLI setups were not run here.** They follow each tool's documented format. Claude Code, Grok CLI and Hermes commands were checked against their `--help`.
- **Cold checks cover Base only.** Other chains get REVIEW with `network_not_base`.
