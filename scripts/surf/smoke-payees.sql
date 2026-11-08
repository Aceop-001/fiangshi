-- Surf smoke: ONE async onchain-sql job over 2 payees on Base (agent.base_transfers).
-- Placeholders __P1__ / __P2__ = lowercase 0x addresses. The window is bounded by the block_date partition (required by Surf).
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
  WHERE block_date >= today() - 365 AND `to` IN ('__P1__', '__P2__')
  UNION ALL
  SELECT `from` AS payee, `to` AS counterparty, block_time, amount_usd, 'out' AS role
  FROM agent.base_transfers
  WHERE block_date >= today() - 365 AND `from` IN ('__P1__', '__P2__')
)
GROUP BY payee
ORDER BY payee
