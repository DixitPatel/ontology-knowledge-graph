-- =====================================================
-- Fit-agent data gaps (docs/AgentCDP/HANDOFF-fit-agent.md, Task 1).
-- Idempotent MERGE, same EDGE_ID = MD5(src||dst||type) rule as the seed.
-- =====================================================
USE SCHEMA SKINCARE_KG.KG;

-- CONTAINS: the two AHA products -> ING:glycolic (approximation -- AHA is
-- not a single ingredient; the product doesn't disclose which acid or at
-- what strength, so PROPS says so explicitly rather than guessing).
MERGE INTO KG_EDGE t
USING (
  SELECT MD5(column1 || column2 || 'CONTAINS') id, column1 src, column2 dst, PARSE_JSON(column3) props
  FROM VALUES
    ('PRD:store:smooth-operator-aha-serum', 'ING:glycolic', '{"as":"aha","strength":"unknown"}'),
    ('PRD:store:glow-barrier-duo',          'ING:glycolic', '{"as":"aha","strength":"unknown"}')
) s ON t.EDGE_ID = s.id
WHEN MATCHED THEN UPDATE SET PROPS = s.props
WHEN NOT MATCHED THEN INSERT (EDGE_ID, SRC_ID, DST_ID, EDGE_TYPE, WEIGHT, PROPS, SOURCE, STATUS)
  VALUES (s.id, s.src, s.dst, 'CONTAINS', 1.0, s.props, 'CURATED', 'ASSERTED');

-- AVOID_WITH: glycolic (AHA) x rosacea. Weight 0.6, below the 0.7 block
-- threshold, so the product reads as caution, not blocked.
MERGE INTO KG_EDGE t
USING (
  SELECT MD5('ING:glycolic' || 'CON:rosacea' || 'AVOID_WITH') id
) s ON t.EDGE_ID = s.id
WHEN MATCHED THEN UPDATE SET WEIGHT = 0.6, PROPS = PARSE_JSON('{"source":"aad_products"}')
WHEN NOT MATCHED THEN INSERT (EDGE_ID, SRC_ID, DST_ID, EDGE_TYPE, WEIGHT, PROPS, SOURCE, STATUS)
  VALUES (s.id, 'ING:glycolic', 'CON:rosacea', 'AVOID_WITH', 0.6, PARSE_JSON('{"source":"aad_products"}'), 'CURATED', 'ASSERTED');

-- AVOIDS: shopper-level ingredient avoidance (new edge type -- the seed's
-- avoid_ingredients list, for the one entry that maps onto a curated
-- ING: node). Not read by RANK_PRODUCTS (personal avoidance isn't scored
-- there yet, a known gap from the earlier Sephora load); FIT_AGENT reads
-- it directly via get_profile/TOOL_GET_PROFILE.
MERGE INTO KG_EDGE t
USING (
  SELECT MD5('SHP:customer_003' || 'ING:glycolic' || 'AVOIDS') id
) s ON t.EDGE_ID = s.id
WHEN MATCHED THEN UPDATE SET PROPS = PARSE_JSON('{"reason":"advisor_recommendation"}')
WHEN NOT MATCHED THEN INSERT (EDGE_ID, SRC_ID, DST_ID, EDGE_TYPE, WEIGHT, PROPS, SOURCE, STATUS, CONFIDENCE)
  VALUES (s.id, 'SHP:customer_003', 'ING:glycolic', 'AVOIDS', 1.0, PARSE_JSON('{"reason":"advisor_recommendation"}'), 'CDP_IMPORT', 'ASSERTED', 1.0);

-- Gate: 2 CONTAINS rows for PRD:store:%, plus the rosacea and AVOIDS edges.
SELECT * FROM KG_EDGE WHERE SRC_ID LIKE 'PRD:store:%';
SELECT * FROM KG_EDGE WHERE SRC_ID = 'ING:glycolic' AND DST_ID = 'CON:rosacea';
SELECT * FROM KG_EDGE WHERE SRC_ID = 'SHP:customer_003' AND EDGE_TYPE = 'AVOIDS';
