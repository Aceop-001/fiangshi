-- Sync-safe inbound facts for a payee ARRAY (single branch: no UNION, no OR, no lower()).
SELECT
  `to`                                    AS payee,
  min(block_time)                         AS first_inbound_at,
  count()                                 AS inbound_count,
  uniqExact(`from`)                       AS distinct_inbound_senders,
  argMin(`from`, block_time)              AS first_inbound_from,
  sum(amount_usd)                         AS inbound_usd
FROM agent.base_transfers
WHERE block_date >= today() - __DAYS__ AND `to` IN (__PAYEES__)
GROUP BY payee
ORDER BY payee
