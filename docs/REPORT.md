# Test report: from failures to green

Fiangshi decides whether an AI agent should pay a stranger, so it has to be believable when it is wrong as well as when it is right. This report keeps every failure on the record: what we saw, why it happened, what we changed, and the evidence that the change worked. Nothing here has been rewritten after the fact. A lab case written under an old rule stays visible as "superseded", not edited.

The lab history, the per-commit test and gate counts, and the last measured status at the end of this page are computed from committed files every time the page loads. Every other number on this page comes from a committed script or fixture, named next to it.

## Where things stand

| measure | value | source |
|---|---|---|
| census | 800 of 1,923 Base payees, 90-day window, taken 9 Nov | `scripts/audit.ts`, `data/numbers.json` |
| verdicts | 49 ALLOW / 539 REVIEW / 212 BLOCK | `scripts/numbers.ts` |
| verdictable payees | 765 (95.6%) | `scripts/winrate.ts` |
| lab | 9 cases: 8 pass, 1 superseded by a documented rule change | `scripts/matrix.ts` |
| real sellers in the lab (controls) | 3 of 3 reach ALLOW | `artifacts/matrix.md` |
| accept gates | 15 of 15, offline, network unplugged | `npm run accept` |
| end to end | 10 of 10 on a local server, with no keys (fixture mode) and with keys (live) | `npm run localhost-check` |
| census cost | 252 credits billed for 800 payees | `fixtures/audit/balances.json` |
| warm check | 251 ms median | `artifacts/demo-stats.json` |
| cold check | 10.8 s, 8 credits, then 237 ms from cache | `artifacts/cold-live.md` |

## How we test

There are four layers, and each one must be green before a commit.

1. **Unit and table tests** (`npm test`, vitest). Pure functions (score, rules, receipts, drift, the probe parser, the markdown renderer, translations) are tested at their edges: 0, the middle, 1, and missing. Each rule has its own table of cases, and a precedence test proves a rule beats a model ALLOW.
2. **Accept gates** (`npm run accept`). Fifteen checks run with the network blocked by a preload that refuses every connection except the local machine. They are listed in the table below.
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

A fifth check runs once per release: a fresh copy of the repository with no keys, then `npm ci`, `npm test`, `npm run accept` and `npm run localhost-check`. It has passed every time since 9 Nov.

## Timeline

| date | phase | what was built | commit |
|---|---|---|---|
| 8 Nov | 0 | skeleton, frozen data contracts (zod), canonical hashing | `c1e9a5c` |
| 8 Nov | 1–7 offline | probe, snapshot, score, rules, model check, receipts, ledger, drift | `f4e431e` |
| 8 Nov | local verification | 10 offline accept gates, the no-network preload | `4256023` |
| 8 Nov | 3b–3f | Surf installed and measured, 12 real 402s recorded, billing model, E v2, models wired live | `c02b184` … `2fb92e4` |
| 9 Nov | 3g–3k | paid audit gate, fixture guard (G11), staged census runner, the 800-payee census | `7bbf99d` … `dfba1ca` |
| 9 Nov | 3l | rule I (null payee), keccak-256 and EIP-55 in the repo, rule set frozen at six | `1706909` |
| 9 Nov | 3m–3n | identity v3, adversarial lab with expectations committed first | `6122b32` … `824ae46` |
| 9 Nov | 3b-fix–3h | optional identity enrichment, API and real 402, end to end check, README, identity neutrality, fixture mode | `0a39c7e` … `0d299d9` |
| 10 Nov | 3i–3k | the site (no script), operator-only identity labels, guide and legal pages, evidence sources | `65e03a5` … `b068d25` |
| 11 Nov | final A–F | kinship calibration, funder labels re-asked, cold check live, win-rate, single source of numbers (G12–G15) | `2fc1608` … `c4a954d` |
| 11–12 Nov | site | guide with real endpoints, test report, crash fix, four languages | `dfce46f` … `07a4e1c` |
| 13 Nov | connect | architecture page, connect guides, MCP server, free JSON preview, first-visit tour | this release |

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

- **Seen.** Commit `290f824` was made while G2 was failing.
- **Cause.** The no-network preload blocked the tests' own local server, and the commit step did not check the exit code.
- **Fix.** The preload allows only the local machine (127.0.0.1, ::1). Every commit is now gated on the exit code of every gate.
- **Proof.** Fixed in the next commit, `29887da`. No red commit since.

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
- **Proof.** B2 still blocks. 120 sellers on likely exchange funders are now REVIEW with the flag `kinship_suspected_exchange`, and there are 123 kinship BLOCKs. `artifacts/sensitivity.md` compares the three policies (G15).

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

## Rule changes, each one measured

Every rule change was simulated on the census before it was applied, and its effect was recorded.

| date | change | effect | file |
|---|---|---|---|
| 8 Nov | E v1 (token share) → E v2 (payer concentration) | E stops rewarding a seller for using one token | `artifacts/capability.md` |
| 9 Nov | rule I added (null payee) | the top-scored dead end is blocked | `src/core/v6.ts` |
| 9 Nov | identity v3 (corroboration by host, path, catalog or label) | simulated first, in `d640df5` | `src/core/identity.ts` |
| 9 Nov | identity optional (timeout never caps) | lab controls reach ALLOW | `src/adapters/dolphin.ts` |
| 9 Nov | identity neutrality | examined sellers are no longer penalised | `src/core/score.ts` |
| 10 Nov | operator-only labels | one false BLOCK becomes REVIEW | `src/core/identity.ts` |
| 11 Nov | kinship v2 (REVIEW at 21+ unlabelled) | 120 BLOCK become REVIEW | `artifacts/sensitivity.md` |

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

## Still failing or not done

These are open, and they are not hidden anywhere else either.

- **The four biggest shared funders have no name.** Surf was asked twice and has no label for them. If they turn out to be exchanges, up to two thirds of BLOCKs could be wrong. The number is published as an upper bound (`artifacts/winrate.md`).
- **No real payment yet.** Settlement is a dry run until the owner pays from their own wallet. Fiangshi will not do it for them.
- **3 real control sellers in the lab, not 10.** The census only had a few sellers that pass every rule with complete data.
- **The age, history and identity rules have no live case.** They are tested on fixtures and tables only.
- **Codex, Cursor, VS Code and Gemini CLI setups were not run here.** They follow each tool's documented format. Claude Code, Grok CLI and Hermes commands were checked against their `--help`.
- **Cold checks cover Base only.** Other chains get REVIEW with `network_not_base`.
