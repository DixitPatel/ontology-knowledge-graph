-- =====================================================
-- SKINCARE KG on Snowflake — hackathon MVP
-- Same KG_NODE / KG_EDGE model as the cancer KG.
-- Ontology = rules (types + edge types). KG = rows.
-- =====================================================

CREATE DATABASE IF NOT EXISTS SKINCARE_KG;
CREATE SCHEMA IF NOT EXISTS SKINCARE_KG.KG;
USE SCHEMA SKINCARE_KG.KG;

-- ---------- 1. Tables ----------
CREATE OR REPLACE TABLE KG_NODE (
  NODE_ID      STRING NOT NULL,   -- e.g. ING:retinol
  NODE_TYPE    STRING NOT NULL,   -- PRODUCT | INGREDIENT | CONCERN | SKIN_TYPE | CONDITION | QUESTION | SHOPPER
  NAME         STRING,
  PROPS        VARIANT,           -- price, url, question text, INCI name
  SOURCE       STRING DEFAULT 'CURATED',
  TS_INGESTED  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_KG_NODE PRIMARY KEY (NODE_ID)
) CLUSTER BY (NODE_TYPE);

CREATE OR REPLACE TABLE KG_EDGE (
  EDGE_ID      STRING NOT NULL,
  SRC_ID       STRING NOT NULL,
  DST_ID       STRING NOT NULL,
  EDGE_TYPE    STRING NOT NULL,   -- see edge list below
  WEIGHT       FLOAT DEFAULT 1.0, -- evidence strength 0..1
  PROPS        VARIANT,           -- {"pct":10} or {"answer":"yes"}
  SOURCE       STRING DEFAULT 'CURATED',  -- CURATED | SESSION | PREDICTED
  STATUS       STRING DEFAULT 'ASSERTED', -- ASSERTED | PROPOSED | ACCEPTED | REJECTED
  CONFIDENCE   FLOAT,             -- Jev probability for PROPOSED / SESSION edges
  TS_INGESTED  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_KG_EDGE PRIMARY KEY (EDGE_ID)
) CLUSTER BY (EDGE_TYPE, SRC_ID, DST_ID);

-- Edge types (the ontology rules):
--   PRODUCT    -CONTAINS->       INGREDIENT   PROPS.pct
--   PRODUCT    -SUITS->          SKIN_TYPE
--   INGREDIENT -TREATS->         CONCERN      WEIGHT = evidence
--   INGREDIENT -AVOID_WITH->     CONDITION | SKIN_TYPE
--   INGREDIENT -CONFLICTS_WITH-> INGREDIENT
--   QUESTION   -ASKS_ABOUT->     CONCERN | SKIN_TYPE | CONDITION
--   SHOPPER    -HAS->            CONCERN | SKIN_TYPE | CONDITION   PROPS.answer (zero-party data)
--   SHOPPER    -USES->           INGREDIENT   (current routine)

-- ---------- 2. Seed data ----------
INSERT INTO KG_NODE (NODE_ID, NODE_TYPE, NAME, PROPS)
SELECT column1, column2, column3, PARSE_JSON(column4) FROM VALUES
 ('ING:retinol','INGREDIENT','Retinol','{}'),
 ('ING:niacinamide','INGREDIENT','Niacinamide','{}'),
 ('ING:azelaic','INGREDIENT','Azelaic acid','{}'),
 ('ING:salicylic','INGREDIENT','Salicylic acid','{}'),
 ('ING:glycolic','INGREDIENT','Glycolic acid','{}'),
 ('ING:hyaluronic','INGREDIENT','Hyaluronic acid','{}'),
 ('ING:vitc','INGREDIENT','Vitamin C','{}'),
 ('CON:acne','CONCERN','Acne','{}'),
 ('CON:pigment','CONCERN','Dark spots','{}'),
 ('CON:aging','CONCERN','Fine lines','{}'),
 ('CON:dry','CONCERN','Dryness','{}'),
 ('SKT:oily','SKIN_TYPE','Oily','{}'),
 ('SKT:dry','SKIN_TYPE','Dry','{}'),
 ('SKT:sensitive','SKIN_TYPE','Sensitive','{}'),
 ('CND:pregnant','CONDITION','Pregnant or nursing','{}'),
 ('PRD:night','PRODUCT','Night Renew Serum','{"price":42}'),
 ('PRD:clear','PRODUCT','Clear Skin Gel','{"price":28}'),
 ('PRD:bright','PRODUCT','Bright Spot Serum','{"price":35}'),
 ('PRD:hydra','PRODUCT','Hydra Cream','{"price":30}'),
 ('Q:acne','QUESTION','Acne','{"text":"Do you get breakouts?"}'),
 ('Q:pigment','QUESTION','Dark spots','{"text":"Are dark spots your main concern?"}'),
 ('Q:sensitive','QUESTION','Sensitive','{"text":"Does your skin react easily?"}'),
 ('Q:pregnant','QUESTION','Pregnancy','{"text":"Are you pregnant or nursing?"}'),
 ('Q:dry','QUESTION','Dry skin','{"text":"Does your skin feel tight or dry?"}');

INSERT INTO KG_EDGE (EDGE_ID, SRC_ID, DST_ID, EDGE_TYPE, WEIGHT, PROPS)
SELECT MD5(column1||column2||column3), column1, column2, column3, column4, PARSE_JSON(column5) FROM VALUES
 ('PRD:night','ING:retinol','CONTAINS',1,'{"pct":0.5}'),
 ('PRD:night','ING:hyaluronic','CONTAINS',1,'{}'),
 ('PRD:clear','ING:salicylic','CONTAINS',1,'{"pct":2}'),
 ('PRD:clear','ING:niacinamide','CONTAINS',1,'{"pct":4}'),
 ('PRD:bright','ING:azelaic','CONTAINS',1,'{"pct":10}'),
 ('PRD:bright','ING:vitc','CONTAINS',1,'{}'),
 ('PRD:hydra','ING:hyaluronic','CONTAINS',1,'{}'),
 ('PRD:clear','SKT:oily','SUITS',1,'{}'),
 ('PRD:hydra','SKT:dry','SUITS',1,'{}'),
 ('PRD:hydra','SKT:sensitive','SUITS',1,'{}'),
 ('ING:retinol','CON:aging','TREATS',0.9,'{}'),
 ('ING:retinol','CON:acne','TREATS',0.6,'{}'),
 ('ING:salicylic','CON:acne','TREATS',0.8,'{}'),
 ('ING:niacinamide','CON:pigment','TREATS',0.6,'{}'),
 ('ING:niacinamide','CON:acne','TREATS',0.5,'{}'),
 ('ING:azelaic','CON:pigment','TREATS',0.8,'{}'),
 ('ING:azelaic','CON:acne','TREATS',0.7,'{}'),
 ('ING:vitc','CON:pigment','TREATS',0.6,'{}'),
 ('ING:hyaluronic','CON:dry','TREATS',0.8,'{}'),
 ('ING:retinol','CND:pregnant','AVOID_WITH',1,'{}'),
 ('ING:salicylic','CND:pregnant','AVOID_WITH',0.7,'{}'),
 ('ING:retinol','SKT:sensitive','AVOID_WITH',0.6,'{}'),
 ('ING:glycolic','SKT:sensitive','AVOID_WITH',0.6,'{}'),
 ('ING:retinol','ING:glycolic','CONFLICTS_WITH',0.8,'{}'),
 ('ING:retinol','ING:vitc','CONFLICTS_WITH',0.5,'{}'),
 ('Q:acne','CON:acne','ASKS_ABOUT',1,'{}'),
 ('Q:pigment','CON:pigment','ASKS_ABOUT',1,'{}'),
 ('Q:sensitive','SKT:sensitive','ASKS_ABOUT',1,'{}'),
 ('Q:pregnant','CND:pregnant','ASKS_ABOUT',1,'{}'),
 ('Q:dry','SKT:dry','ASKS_ABOUT',1,'{}');

-- ---------- 3. Derived view: what each product touches ----------
CREATE OR REPLACE VIEW PRODUCT_ATTR AS
SELECT SRC_ID AS PRODUCT_ID, DST_ID AS ATTR_ID FROM KG_EDGE WHERE EDGE_TYPE='SUITS'
UNION
SELECT c.SRC_ID, t.DST_ID FROM KG_EDGE c JOIN KG_EDGE t
  ON c.DST_ID=t.SRC_ID AND c.EDGE_TYPE='CONTAINS' AND t.EDGE_TYPE IN ('TREATS','AVOID_WITH');

-- ---------- 4. Endpoint functions ----------
-- 4a. Record an answer (zero-party data -> CDP profile edge)
CREATE OR REPLACE PROCEDURE RECORD_ANSWER(SHOPPER STRING, QUESTION STRING, ANSWER STRING)
RETURNS STRING LANGUAGE SQL AS
$$
BEGIN
  MERGE INTO KG_NODE n USING (SELECT :SHOPPER id) s ON n.NODE_ID=s.id
    WHEN NOT MATCHED THEN INSERT (NODE_ID, NODE_TYPE, SOURCE) VALUES (s.id,'SHOPPER','SESSION');
  MERGE INTO KG_EDGE e
  USING (SELECT :SHOPPER src, DST_ID dst FROM KG_EDGE WHERE SRC_ID=:QUESTION AND EDGE_TYPE='ASKS_ABOUT') a
    ON e.SRC_ID=a.src AND e.DST_ID=a.dst AND e.EDGE_TYPE='HAS'
  WHEN MATCHED THEN UPDATE SET PROPS=OBJECT_CONSTRUCT('answer',:ANSWER), TS_INGESTED=CURRENT_TIMESTAMP()
  WHEN NOT MATCHED THEN INSERT (EDGE_ID,SRC_ID,DST_ID,EDGE_TYPE,PROPS,SOURCE)
    VALUES (MD5(a.src||a.dst||'HAS'), a.src, a.dst, 'HAS', OBJECT_CONSTRUCT('answer',:ANSWER), 'SESSION');
  RETURN 'ok';
END;
$$;

-- 4b. Ranked products with reasons and blocks
CREATE OR REPLACE FUNCTION RANK_PRODUCTS(SHOPPER STRING)
RETURNS TABLE (PRODUCT_ID STRING, NAME STRING, FIT FLOAT, BLOCKED BOOLEAN, REASONS ARRAY)
AS
$$
WITH yes AS (
  SELECT DST_ID FROM KG_EDGE WHERE SRC_ID=SHOPPER AND EDGE_TYPE='HAS' AND PROPS:answer::STRING='yes'
),
scored AS (
  SELECT c.SRC_ID pid,
         SUM(IFF(t.EDGE_TYPE='TREATS', t.WEIGHT, 0)) fit,
         MAX(IFF(t.EDGE_TYPE='AVOID_WITH' AND t.WEIGHT>=0.7, 1, 0)) blocked,
         ARRAY_AGG(DISTINCT ing.NAME||IFF(t.EDGE_TYPE='TREATS',' helps ',' caution: ')||y_n.NAME) reasons
  FROM KG_EDGE c
  JOIN KG_EDGE t ON c.DST_ID=t.SRC_ID AND t.EDGE_TYPE IN ('TREATS','AVOID_WITH')
  JOIN yes ON yes.DST_ID=t.DST_ID
  JOIN KG_NODE ing ON ing.NODE_ID=c.DST_ID
  JOIN KG_NODE y_n ON y_n.NODE_ID=t.DST_ID
  WHERE c.EDGE_TYPE='CONTAINS'
  GROUP BY c.SRC_ID
)
SELECT p.NODE_ID, p.NAME, COALESCE(s.fit,0), COALESCE(s.blocked,0)=1, COALESCE(s.reasons,[])
FROM KG_NODE p LEFT JOIN scored s ON s.pid=p.NODE_ID
WHERE p.NODE_TYPE='PRODUCT'
$$;

-- 4c. Next question: unanswered question whose attribute splits the
--     remaining (unblocked) products closest to 50/50 (max information gain).
CREATE OR REPLACE FUNCTION NEXT_QUESTION(SHOPPER STRING)
RETURNS TABLE (QUESTION_ID STRING, TEXT STRING, SPLIT FLOAT)
AS
$$
WITH cand AS (SELECT PRODUCT_ID FROM TABLE(RANK_PRODUCTS(SHOPPER)) WHERE NOT BLOCKED),
n AS (SELECT COUNT(*) total FROM cand),
answered AS (SELECT DST_ID FROM KG_EDGE WHERE SRC_ID=SHOPPER AND EDGE_TYPE='HAS')
SELECT q.SRC_ID, qn.PROPS:text::STRING,
       (COUNT(DISTINCT pa.PRODUCT_ID) / NULLIF(MAX(n.total),0))::FLOAT AS split
FROM KG_EDGE q
JOIN KG_NODE qn ON qn.NODE_ID=q.SRC_ID
CROSS JOIN n
LEFT JOIN PRODUCT_ATTR pa ON pa.ATTR_ID=q.DST_ID AND pa.PRODUCT_ID IN (SELECT PRODUCT_ID FROM cand)
WHERE q.EDGE_TYPE='ASKS_ABOUT' AND q.DST_ID NOT IN (SELECT DST_ID FROM answered)
GROUP BY q.SRC_ID, qn.PROPS:text::STRING
ORDER BY ABS(split - 0.5) ASC
LIMIT 1
$$;

-- 4d. Routine conflicts (shopper USES x, product CONTAINS y, x CONFLICTS_WITH y)
CREATE OR REPLACE FUNCTION ROUTINE_CONFLICTS(SHOPPER STRING, PRODUCT STRING)
RETURNS TABLE (USED STRING, IN_PRODUCT STRING, SEVERITY FLOAT)
AS
$$
SELECT u.DST_ID, c.DST_ID, x.WEIGHT
FROM KG_EDGE u
JOIN KG_EDGE x ON x.EDGE_TYPE='CONFLICTS_WITH'
JOIN KG_EDGE c ON c.SRC_ID=PRODUCT AND c.EDGE_TYPE='CONTAINS'
WHERE u.SRC_ID=SHOPPER AND u.EDGE_TYPE='USES'
  AND ((x.SRC_ID=u.DST_ID AND x.DST_ID=c.DST_ID) OR (x.DST_ID=u.DST_ID AND x.SRC_ID=c.DST_ID))
$$;

-- ---------- 5. Smoke test ----------
CALL RECORD_ANSWER('SHP:demo','Q:pregnant','yes');
CALL RECORD_ANSWER('SHP:demo','Q:acne','yes');
SELECT * FROM TABLE(RANK_PRODUCTS('SHP:demo')) ORDER BY BLOCKED, FIT DESC;
--   expect: Bright Spot Serum on top (azelaic: acne, pregnancy-safe);
--           Night Renew Serum BLOCKED (retinol + pregnant)
SELECT * FROM TABLE(NEXT_QUESTION('SHP:demo'));
