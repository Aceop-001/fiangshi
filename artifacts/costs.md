# Costs ledger

| time | provider | label | call # / cap | units | status |
|---|---|---|---|---|---|
| 2026-11-08T15:36:01Z | surf | onchain-schema (discovery) | 1/3 data calls this phase | 1 | ok, 2612ms, 111 tables |
| 2026-11-08T16:22:58.721Z | surf | onchain-sql-job-create payees=2 | 1/60 | - | error: Error |
| 2026-11-08T16:24:01.357Z | surf | onchain-sql payee-inbound payees=2 | 2/60 | 5 | ok |
| 2026-11-08T16:24:03.950Z | surf | onchain-sql payee-outbound payees=2 | 3/60 | 5 | ok |
| 2026-11-08T16:24:26.253Z | surf | onchain-sql payee-inbound payees=12 | 4/60 | 5 | ok |
| 2026-11-08T16:24:30.664Z | surf | onchain-sql payee-outbound payees=12 | 5/60 | 5 | ok |
| 2026-11-08T16:27:03.734Z | surf | wallet-labels-batch n=23 | 6/60 | 1 | ok |
| 2026-11-08T16:41:35.400Z | surf | onchain-sql payee-inbound payees=2 | 7/60 | 5 | ok |
| 2026-11-09T02:01:23.049Z | surf | onchain-sql payee-inbound payees=100 | 8/60 | 5 | ok |
| 2026-11-09T02:01:57.199Z | surf | onchain-sql payee-outbound payees=100 | 9/60 | - | error: Error |
| 2026-11-09T02:27:12.614Z | serv | adjudicate 0x4aabe17c | 1/100 | 1041 | ok |
| 2026-11-09T02:27:21.361Z | serv | adjudicate 0xf567cfe0 | 2/100 | 1017 | ok |
| 2026-11-09T02:27:32.937Z | dolphin | extract 5e9c93d5 | 1/30 | - | error: Error |
| 2026-11-09T02:27:36.066Z | dolphin | extract 5955300d | 2/30 | 295 | ok |
| 2026-11-09T02:28:02.736Z | dolphin | extract 5e9c93d5 | 3/30 | 602 | ok |
| 2026-11-09T02:34:43.293Z | surf | onchain-sql-job-create payee-inbound payees=5 | 10/150 | 4 | ok |
| 2026-11-09T02:35:06.746Z | surf | onchain-sql-job-create payee-inbound payees=50 | 11/150 | 4 | ok |
| 2026-11-09T02:35:12.757Z | surf | onchain-sql-job-get | poll (not budget-counted) | 0 | ok |
| 2026-11-09T02:35:52.018Z | surf | onchain-sql-preflight payee-inbound payees=50 days=365 | 12/150 | 4 | ok |
