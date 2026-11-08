-- Sync-safe outbound facts for a payee ARRAY (single branch: no UNION, no OR, no lower()).
-- Also used over FUNDERS: distinct_outbound_receivers drives the exchange-like fanout heuristic.
SELECT
  `from`                                  AS payee,
  min(block_time)                         AS first_outbound_at,
  max(block_time)                         AS last_outbound_at,
  count()                                 AS outbound_count,
  uniqExact(`to`)                         AS distinct_outbound_receivers
FROM agent.base_transfers
WHERE block_date >= today() - __DAYS__ AND `from` IN (__PAYEES__)
GROUP BY payee
ORDER BY payee
