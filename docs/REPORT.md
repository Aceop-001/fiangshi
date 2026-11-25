# Test report: from failures to green

Fiangshi decides whether an AI agent should pay a stranger, so it has to be believable when it is wrong as well as when it is right. This report keeps every failure on the record: what we saw, why it happened, what we changed, and the evidence that the change worked. Nothing here has been rewritten after the fact. A lab case written under an old rule stays visible as "superseded", not edited.

The lab history, the per-commit test and gate counts, and the last measured status at the end of this page are computed from committed files every time the page loads. Every other number on this page comes from a committed script or fixture, named next to it.

## Where things stand

| measure | value | source |
|---|---|---|
| census | 1,923 of 1,923 Base payees, 90-day window, refreshed 20 Nov (each record with its own `as_of`) | `scripts/audit.ts`, `data/numbers.json` |
| verdicts | 159 ALLOW / 1,243 REVIEW / 521 BLOCK, policy `2026-11-13.5` | `scripts/numbers.ts` |
| verdictable payees | 1,876 (97.6%) | `scripts/winrate.ts` |
| lab | 9 cases: 8 pass, 1 superseded by a documented rule change | `scripts/matrix.ts` |
| real sellers in the lab (controls) | 3 of 3 reach ALLOW | `artifacts/matrix.md` |
| accept gates | 17 of 17, offline, network unplugged | `npm run accept` |
| end to end | 10 of 10 on a local server, with no keys (fixture mode) and with keys (live) | `npm run localhost-check` |
| census cost | 484 credits billed for the 20 Nov refresh of 1,923 payees, labels reused (the 17 Nov refresh cost 540; the 13 Nov refresh cost 620; the 9 Nov census of 800 cost 252) | `fixtures/audit/balances.json` |
| warm check | 251 ms median | `artifacts/demo-stats.json` |
| cold check | 10.8 s, 8 credits, then 237 ms from cache | `artifacts/cold-live.md` |
| paid check, live | `api.fiangshi.xyz` answers 402 (Base USDC, $0.05, paid to the operator wallet); with a test payment header: ALLOW 88.33 on Bitrefill, SERV and Dolphin both answered, 3.6 s, receipt verifies. Settlement live since 25 Nov: one real $0.05 payment settled through the CDP facilitator, tx [`0x90b91981…9696`](https://basescan.org/tx/0x90b919810c9c3a3b6707a1847261d00609018ca42bd15ff9a2fcd10867af9696) (F28) | `docs/GUIDE.md` (captured 402), `tests/guide-examples.test.ts` |
| freshness | every census record carries its own `as_of`; data older than 72 h caps ALLOW at REVIEW (policy `2026-11-13.5`); the static site rebuilds hourly so its pages cap stale records too (F26) | `artifacts/refresh.md`, gate G16, `.github/workflows/pages.yml` |
| independent verification | Argus Agent Test Lab, record [`argus-seal-0032`](https://github.com/igor-vii/Argus-Agent-Test-Lab/blob/main/attestations/records/0032-fiangshi-census-receipt-anchoring-aceop-001-fiangshi-1d19e40.seal.json) (24 Nov): a $0.00 third-party check of the census receipts at commit `1d19e40` (no paid call, no funds moved). 11 MATCH, 0 DIVERGENCE, verdict SEAL: every receipt hash recomputed, the chain walked offline from git, the Bitrefill and cleave.fi cases classified as frozen beforehand. Live-check receipts were not covered (the receipt store was not on; recorded as documented, not a match). Anyone can re-check it: `git clone https://github.com/igor-vii/Argus-Agent-Test-Lab && node tools/registry/verify-registry.mjs` | [issue #1](https://github.com/Aceop-001/fiangshi/issues/1) |

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

### Real payments on Base mainnet (buyer side, 15 Nov)

Fiangshi's own fee stayed a dry run until 25 Nov (F28). To test the other side, a demo agent run from Claude Code asked Fiangshi about each seller first and then paid the allowed ones in real USDC on Base mainnet (chain 8453, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), from four small test wallets used one after another.

**Paid, after a check.** Each wallet paid twit.sh $0.006 and CoinMarketCap $0.010. The twit.sh payments are on chain; each hash below was looked up on Base and returned `status: success`, 0.006 USDC from the test wallet to the seller (`0x9dba414637c611a16bea6f0796bfcbcbdc410df8`):

| wallet | block | twit.sh payment |
|---|---|---|
| `0xa3aACEe8CCe50209491D5136A64E1893718715d0` | 57,744,391 | `0xd1d22f0896ecaf07acc5add6b413d16c1487f6ce35cf03bca19f77beeb3a6fbf` |
| `0xDcfEbb90f90452b4236a086696929AD5748007cD` | 57,756,190 | `0x8b7e948c8e7fcb3f39797a3b1dd1efb7e0ea7919c557a97e49a21790611f8dbb` |
| `0x39803061119B5911f48dbAdFD3740c4E361fDa4F` | 57,765,181 | `0x01bd49c051d7175cf8ee64761d9d074cc67af840e65edf8f9a2c84785f269330` |
| `0x2DfF8fB467D8968d95d6eE6311CE9c4d9171303d` | 57,794,100 | `0x4e7ad56c71d084453e3a2e5271210c0f4634e143ae80cbb87c6f078031463271` |

CoinMarketCap returned no transaction hash in its response; its payments are confirmed by each wallet's balance change, not by a hash.

**Refused before paying, at $0.00.** Two BTC forecast sellers came back BLOCK on the kinship rule (their first funder also funded about 20 other sellers), so nothing was paid:

| seller | price | Fiangshi |
|---|---|---|
| `kronos.forgemesh.io/api/kronos/forecast` | $0.05 | BLOCK, score 52.61, kinship |
| `api.nexismvp.com/forecast/btc` | $0.001 | BLOCK, score 62.18, kinship |

Each run therefore avoided $0.051. Two other sellers (2s.io, x402financialdata) rejected the request's parameters (HTTP 400 and 422) and took no USDC.

**Volume.** 11 real payments, 0.090 USDC in total, over 5 runs and 4 wallets: four runs of twit.sh + CoinMarketCap at 0.016 USDC each, and one run at 0.026 USDC that included the duplicate CoinMarketCap payment from F25. 4 of the 11 (0.024 USDC) are confirmed by transaction hash on chain, as listed above; the other 7 (0.066 USDC) by the wallets' balance changes, because CoinMarketCap returns no hash and the second run with the second wallet recorded none for twit.sh.

**A bug found live:** a retry paid one seller twice. It is F25 below, with its fix.

All four test wallets are retired and hold 0 USDC (read from the chain on 15 Nov).

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
| 13 Nov | durable receipts | the paid answer carries its receipt and a verify URL, honest payload verification, ledger mirror, gate G17 | `986fe44` |

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

### F25. A retry paid a seller twice (15 Nov)

- **Seen.** In the buyer-side mainnet test (see "Real payments on Base mainnet" above), one run with the second wallet spent 0.026 USDC where the two paid calls should have cost 0.016. The CoinMarketCap call had been paid twice.
- **Cause.** The demo agent retried a request after it had already sent the payment header. The first payment had gone through, so the retry paid again.
- **Fix.** The payment step in the demo agent is no longer retried: any error after the payment header is sent ends the call ("may have settled, not retrying"). Balances are read before and after every payment.
- **Proof.** The next run with the same wallet spent exactly 0.016 USDC for the same two calls. The fix is in the demo agent, not in this repository; Fiangshi itself never pays.

### F26. The static pages said the census was fresh after it went stale (17 Nov)

- **Seen.** On 17 Nov the 13 Nov census was 87.5 hours old, past the 72-hour limit. The live API answered correctly: every record stale, 0 ALLOW, Bitrefill REVIEW with `band_cap` "data_stale". The static site still said "1 of 1,923 verdicts past the window" and "ALLOW 127", and `/judges` promised Bitrefill ALLOW.
- **Cause.** The static site is built only when code is pushed, and its freshness is computed at build time. With no push after 13 Nov, the pages kept the freshness of their last build while the API, which reads the clock on every request, moved on.
- **Fix.** The census was refreshed (17 Nov, 540 credits; `artifacts/refresh-2026-11-17.md`) and every page regenerated. The Pages workflow now also runs every hour (`.github/workflows/pages.yml`, cron `17 * * * *`): each run rebuilds the site from the committed census against the real clock, so stale records are capped on the pages within the hour, as they are in the API. The hourly run makes no Surf call, spends no credits and commits nothing; only a refresh fetches new data.
- **Proof.** After the 17 Nov deploy, the live API and the pages agree: `/v1/index.json` and the home page both show 160 ALLOW / 1,227 REVIEW / 536 BLOCK with 1 stale record, and the Bitrefill preview and the `/judges` example both read ALLOW 90.59.

### F27. The census went stale again, and the refresh hit billed timeouts (20 Nov)

- **Seen.** At 03:29 UTC on 20 Nov every 17 Nov record had passed the 72-hour limit: the live census served 0 ALLOW / 1,387 REVIEW / 536 BLOCK, as the stale cap is meant to. During the refresh, 13 Surf SQL calls were killed at the 25 s per-call limit (each billed 4 credits, no rows), and 150 payees were set aside as scan-heavy after their 25-payee groups failed twice. Twice the run stopped itself on the per-chunk cost limit.
- **Cause.** Staleness is by design: data older than 72 hours cannot vouch for ALLOW, and only a paid refresh renews it. The timeouts were batch size, not slow payees: no successful call in the run took longer than 24.7 s (median 2.6 s, 90th percentile 13.1 s), so a 25- or 50-payee group either answered well inside the limit or did not answer at all.
- **Fix.** A third refresh (`sample-census-r4`, labels seeded from 17 Nov) re-collected all 1,922 payees for 484 credits by balance (888 → 404, cap 560). The 150 set-aside payees were collected in groups of 12, never re-sending a failed address set, with 0 timeouts (the original list is kept as `excluded_first_pass` in the checkpoint). The per-chunk cost limit went from 10 to 20 credits for the resumed run, so one billed timeout no longer stops it; the floor of 328 credits still bounded the whole spend.
- **Proof.** `/v1/index.json` serves census `2026-11-20T03:52Z` with 159 ALLOW / 1,243 REVIEW / 521 BLOCK and 1 stale record (the zero address, carried over). `artifacts/refresh.md` has the credit readings and the movement against the 17 Nov snapshot (1,704 payees unchanged, 121 of the 160 ALLOWs kept). The next refresh is due before 23 Nov 03:52 UTC.

### F28. Receipts and settlement were built but switched off (25 Nov)

- **Seen.** `/health` read `settlement: "dry-run"` and live check receipts reset on every redeploy (`store_total: null`), although durable receipts and live settlement had shipped on 24 Nov. A judge reading `/health` saw a service that could not keep a receipt or take a payment.
- **Cause.** Both are off until the operator sets them, by design: `FIANGSHI_RECEIPTS_REPO` and `FIANGSHI_RECEIPTS_TOKEN` for the receipt store, `FIANGSHI_SETTLE=live` with the CDP API key for settlement. On the way, `/health` could not say which setting was missing: the keys were set but the switch never reached the service, and it read "dry-run" with no reason. `/health` now names each piece (`settlement_check`), never a value, and tolerates a stray space or capital.
- **Fix.** The receipt store points at the public repo github.com/Aceop-001/fiangshi-receipts. Live settlement uses the Coinbase CDP x402 facilitator: it verified the payer's signature before the check and submitted the payer's transfer after it. Fiangshi never signed, sent or held anything.
- **Proof.** A dry-run receipt (`34160e4a…`) created at 03:50 UTC came back after a redeploy (new process 03:55 UTC) from `source: "store"`, valid, with `chain_linkage: verified`. Then one real payment: [`0x90b919810c9c3a3b6707a1847261d00609018ca42bd15ff9a2fcd10867af9696`](https://basescan.org/tx/0x90b919810c9c3a3b6707a1847261d00609018ca42bd15ff9a2fcd10867af9696), Base block 61,948,758, 2026-11-25 04:15:27 UTC, status Success, 0.05 USDC from a burner wallet (`0x0C3e…B8F1`) to the payTo `0x0FdE…6007`, submitted by the facilitator. Its receipt `682a85d7f78c…` reads `settlement: "settled"` with that tx hash, is committed to the receipt store, and links to the dry-run receipt before it across the redeploy. `/v1/stats`: settled_checks_24h 1, usd_settled_24h 0.05, lifetime from the store. The payer is the operator's own test wallet: this proves the path, not a customer.

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
| refresh cost (20 Nov) | 464 credits for SQL: 102 calls, 13 killed at the 25 s limit and billed; the slowest successful call took 24.7 s | when 25- or 50-payee groups time out, split to 12: 0 timeouts in 13 groups |
| label coverage | 171 of 3,108 addresses returned a label row (5.5%), 82 with a name or type | most funders stay unnamed; kinship can only exempt what Surf names |

## Still failing or not done

These are open, and they are not hidden anywhere else either.

- **Most shared funders have no name.** 48 of the 51 funders behind a kinship vow have no Surf label. If they turn out to be exchanges or relayers, up to 477 of the 521 BLOCKs (92%) could be wrong. The number is published as an upper bound (`artifacts/winrate.md`).
- **The first funder of an old wallet drifts with the window** (F20). Not fixed in this pass, because it needs a rubric change.
- **The census goes stale on 23 Nov around 03:52 UTC.** After 72 hours every ALLOW serves as REVIEW until the next refresh. That is the cap working, not a fault.
- **The public API's ledger is ephemeral.** No mirror is configured on Render's free tier, so ids are forgotten on redeploy; receipts stay verifiable from their payload.
- **No customer payment yet.** Live settlement works: one real $0.05 payment settled on 25 Nov (F28). It came from the operator's own burner wallet, so it proves the payment path end to end, not demand. No outside agent has paid for a check.
- **3 real control sellers in the lab, not 10.** The census only had a few sellers that pass every rule with complete data.
- **The age, history and identity rules have no live case.** They are tested on fixtures and tables only.
- **Codex, Cursor, VS Code and Gemini CLI setups were not run here.** They follow each tool's documented format. Claude Code, Grok CLI and Hermes commands were checked against their `--help`.
- **Cold checks cover Base only.** Other chains get REVIEW with `network_not_base`.
