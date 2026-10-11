-- =====================================================
-- Seed shopper SHP:customer_003 (Dixit) into the KG so the
-- "Who is this product for?" panel reads its Skin & Routine tab
-- from Snowflake via the proxy's GET /profile/{shopper}.
-- Mirrors theme/assets/am-i-for-you-seed.js. Idempotent (MERGE).
-- Run: snow sql -c kg -f docs/Snowflake_profile_seed.sql
--
-- New edge types (shopper-scoped, ignored by the agent tools):
--   SHOPPER -WANTS->        GOAL
--   SHOPPER -ROUTINE_STEP-> PRODUCT   PROPS {lane, step, product_type, key_ingredient}
-- HAS edges carry PROPS {field, source, observed_at, rank, severity}.
-- =====================================================
USE SCHEMA SKINCARE_KG.KG;

MERGE INTO KG_NODE t
USING (SELECT column1 id, column2 typ, column3 name, PARSE_JSON(column4) props FROM VALUES
  ('SHP:customer_003','SHOPPER','Dixit','{"age_band":"35-44","climate":"coastal_mild","routine_observed_at":"2026-09-01"}'),
  ('CON:rosacea','CONCERN','Rosacea','{}'),
  ('CON:redness','CONCERN','Redness','{}'),
  ('FTZ:I','SKIN_TONE','I','{}'),
  ('GOAL:calm_redness','GOAL','Calm redness','{}'),
  ('GOAL:simple_routine','GOAL','Simple routine','{}'),
  ('PRD:ext:SK-CLN-201','PRODUCT','Daily Kit Gel Cleanser','{"price":14,"sku":"SK-CLN-201"}'),
  ('PRD:ext:SK-AZA-010','PRODUCT','Quiet Tone Azelaic 10%','{"price":32,"sku":"SK-AZA-010"}'),
  ('PRD:ext:SK-SPF-330','PRODUCT','Shoreline Mineral SPF 30','{"price":28,"sku":"SK-SPF-330"}'),
  ('PRD:ext:SK-MST-045','PRODUCT','Still Water Barrier Cream','{"price":34,"sku":"SK-MST-045"}'),
  ('PRD:store:glow-barrier-duo','PRODUCT','Glow Barrier Duo','{"price":45}'),
  ('PRD:store:cloud-whip-moisturiser','PRODUCT','Cloud Whip Barrier Restore Moisturiser','{"price":28}'),
  ('PRD:store:smooth-operator-aha-serum','PRODUCT','Smooth Operator AHA Serum','{"price":24}')
) s ON t.NODE_ID = s.id
WHEN MATCHED THEN UPDATE SET NAME = s.name, PROPS = s.props
WHEN NOT MATCHED THEN INSERT (NODE_ID, NODE_TYPE, NAME, PROPS, SOURCE)
  VALUES (s.id, s.typ, s.name, s.props, 'CDP_IMPORT');

-- EDGE_ID includes lane so the same cleanser can sit in AM and PM.
MERGE INTO KG_EDGE t
USING (SELECT MD5(column1||column2||column3||column6) id, column1 src, column2 dst, column3 et,
              column4 conf, PARSE_JSON(column5) props FROM VALUES
  ('SHP:customer_003','SKT:dry','HAS',0.7,'{"field":"type","source":"self_reported_quiz","observed_at":"2026-03-02"}',''),
  ('SHP:customer_003','SKT:sensitive','HAS',0.9,'{"field":"sensitivity","source":"self_reported_quiz","observed_at":"2026-03-02"}',''),
  ('SHP:customer_003','FTZ:I','HAS',0.95,'{"field":"fitzpatrick","source":"in_store_scan","observed_at":"2026-04-15"}',''),
  ('SHP:customer_003','CON:rosacea','HAS',1,'{"field":"concern","rank":"primary","severity":"moderate","source":"self_reported_quiz"}',''),
  ('SHP:customer_003','CON:redness','HAS',1,'{"field":"concern","rank":"secondary","severity":"moderate","source":"self_reported_quiz"}',''),
  ('SHP:customer_003','CON:dry','HAS',1,'{"field":"concern","rank":"secondary","severity":"mild","source":"advisor_note"}',''),
  ('SHP:customer_003','GOAL:calm_redness','WANTS',1,'{"order":1}',''),
  ('SHP:customer_003','GOAL:simple_routine','WANTS',1,'{"order":2}',''),
  ('SHP:customer_003','PRD:ext:SK-CLN-201','ROUTINE_STEP',1,'{"lane":"am","step":1,"product_type":"cleanser","key_ingredient":null}','am'),
  ('SHP:customer_003','PRD:ext:SK-AZA-010','ROUTINE_STEP',1,'{"lane":"am","step":2,"product_type":"treatment","key_ingredient":"azelaic_acid"}','am'),
  ('SHP:customer_003','PRD:ext:SK-SPF-330','ROUTINE_STEP',1,'{"lane":"am","step":3,"product_type":"sunscreen","key_ingredient":"zinc_oxide"}','am'),
  ('SHP:customer_003','PRD:ext:SK-CLN-201','ROUTINE_STEP',1,'{"lane":"pm","step":1,"product_type":"cleanser","key_ingredient":null}','pm'),
  ('SHP:customer_003','PRD:ext:SK-MST-045','ROUTINE_STEP',1,'{"lane":"pm","step":2,"product_type":"moisturizer","key_ingredient":"ceramides"}','pm')
) s ON t.EDGE_ID = s.id
WHEN MATCHED THEN UPDATE SET PROPS = s.props, CONFIDENCE = s.conf, STATUS = 'ASSERTED'
WHEN NOT MATCHED THEN INSERT (EDGE_ID, SRC_ID, DST_ID, EDGE_TYPE, WEIGHT, PROPS, SOURCE, STATUS, CONFIDENCE)
  VALUES (s.id, s.src, s.dst, s.et, 1, s.props, 'CDP_IMPORT', 'ASSERTED', s.conf);

-- The routine products contain these actives, so conflict checks can see them.
MERGE INTO KG_EDGE t
USING (SELECT MD5(column1||column2||'CONTAINS') id, column1 src, column2 dst FROM VALUES
  ('PRD:ext:SK-AZA-010','ING:azelaic')) s ON t.EDGE_ID = s.id
WHEN NOT MATCHED THEN INSERT (EDGE_ID, SRC_ID, DST_ID, EDGE_TYPE, WEIGHT, PROPS, SOURCE)
  VALUES (s.id, s.src, s.dst, 'CONTAINS', 1, PARSE_JSON('{"pct":10}'), 'CDP_IMPORT');

-- Check: 13 rows (3 skin + 3 concerns + 2 goals + 5 routine steps).
SELECT e.EDGE_TYPE, e.DST_ID, n.NAME, e.CONFIDENCE, e.PROPS
FROM KG_EDGE e JOIN KG_NODE n ON n.NODE_ID = e.DST_ID
WHERE e.SRC_ID = 'SHP:customer_003' ORDER BY e.EDGE_TYPE, e.DST_ID;
