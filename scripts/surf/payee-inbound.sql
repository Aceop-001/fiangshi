-- Sync-safe inbound facts for a payee ARRAY (single branch: no UNION, no OR, no lower()).
-- top_token_share = share of inbound USD in the largest token (informational: x402 sellers are ~1.0 by design).
-- top_payer_share = share of inbound USD from the largest single sender (E v2 input).
-- Both use the same sumMap/arrayMax shape validated on 2026-11-08 (fixtures/surf/smoke-inbound-v2-check.json).
SELECT
  `to`                                    AS payee,
  min(block_time)                         AS first_inbound_at,
  max(block_time)                         AS last_inbound_at,
  count()                                 AS inbound_count,
  uniqExact(`from`)                       AS distinct_inbound_senders,
  argMin(`from`, block_time)              AS first_inbound_from,
  sum(amount_usd)                         AS inbound_usd,
  if(sum(ifNull(amount_usd, 0)) > 0,
     arrayMax(tupleElement(sumMap([contract_address], [toFloat64(ifNull(amount_usd, 0))]), 2)) / sum(ifNull(amount_usd, 0)),
     NULL)                                AS top_token_share,
  if(sum(ifNull(amount_usd, 0)) > 0,
     arrayMax(tupleElement(sumMap([`from`], [toFloat64(ifNull(amount_usd, 0))]), 2)) / sum(ifNull(amount_usd, 0)),
     NULL)                                AS top_payer_share
FROM agent.base_transfers
WHERE block_date >= today() - __DAYS__ AND `to` IN (__PAYEES__)
GROUP BY payee
ORDER BY payee
