-- Surf payee facts: ONE async onchain-sql job over a payee ARRAY on Base (agent.base_transfers).
-- __PAYEES__ is replaced by scripts/surf/payee-facts.ts with a validated, lowercased, quoted list: '0x..','0x..'
-- Window = block_date partition (required by Surf). first_seen is therefore a LOWER BOUND within the window.
-- Inbound and outbound are separate UNION ALL branches (Surf rule: never OR the from/to predicates).
SELECT
  payee,
  min(block_time)                                    AS first_seen,
  count()                                            AS transfer_count_window,
  countIf(role = 'in')                               AS inbound_count,
  uniqExactIf(counterparty, role = 'in')             AS distinct_inbound_senders,
  argMinIf(counterparty, block_time, role = 'in')    AS first_inbound_from,
  sumIf(amount_usd, role = 'in')                     AS inbound_usd
FROM (
  SELECT `to` AS payee, `from` AS counterparty, block_time, amount_usd, 'in' AS role
  FROM agent.base_transfers
  WHERE block_date >= today() - __DAYS__ AND `to` IN (__PAYEES__)
  UNION ALL
  SELECT `from` AS payee, `to` AS counterparty, block_time, amount_usd, 'out' AS role
  FROM agent.base_transfers
  WHERE block_date >= today() - __DAYS__ AND `from` IN (__PAYEES__)
)
GROUP BY payee
ORDER BY payee
