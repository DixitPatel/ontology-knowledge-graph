-- =====================================================
-- CDP_AGENT v2: the agent's only job is to mutate the shopper's
-- personal KG from on-site events. No verdict, no ranking.
-- Supersedes the agent spec in Snowflake_mdcdp_agent.sql.
-- Re-creates procs + agent only; EVENT_LOG and views are untouched.
-- Run: snow sql -c kg -f docs/Snowflake_agent_writer.sql
-- =====================================================
USE SCHEMA SKINCARE_KG.KG;

-- Store products as KG nodes, so INTEREST events have a valid target.
-- Same rows as in Snowflake_profile_seed.sql; MERGE makes a re-run harmless.
MERGE INTO KG_NODE t
USING (SELECT column1 id, column2 name, PARSE_JSON(column3) props FROM VALUES
  ('PRD:store:glow-barrier-duo','Glow Barrier Duo','{"price":45}'),
  ('PRD:store:cloud-whip-moisturiser','Cloud Whip Barrier Restore Moisturiser','{"price":28}'),
  ('PRD:store:smooth-operator-aha-serum','Smooth Operator AHA Serum','{"price":24}')
) s ON t.NODE_ID = s.id
WHEN NOT MATCHED THEN INSERT (NODE_ID, NODE_TYPE, NAME, PROPS, SOURCE)
  VALUES (s.id, 'PRODUCT', s.name, s.props, 'CDP_IMPORT');

-- Write or strengthen one fact. Records provenance (source, date) in PROPS.
-- Skin type is single-valued: a new one retracts the old (sensitive is separate).
CREATE OR REPLACE PROCEDURE TOOL_UPSERT_FACT(SHOPPER STRING, EDGE_TYPE STRING, TARGET STRING,
                                             ORIGIN STRING, CONFIDENCE FLOAT)
RETURNS STRING LANGUAGE SQL AS
$$
DECLARE
  ttype STRING;
  fld STRING;
BEGIN
  IF (:EDGE_TYPE NOT IN ('HAS','USES','INTERESTED_IN','WANTS')) THEN RETURN 'rejected: bad edge type'; END IF;
  SELECT MAX(NODE_TYPE) INTO :ttype FROM KG_NODE WHERE NODE_ID = :TARGET;
  IF (ttype IS NULL) THEN RETURN 'rejected: unknown node ' || :TARGET; END IF;
  IF (:EDGE_TYPE IN ('HAS','USES') AND :ORIGIN <> 'STATED') THEN RETURN 'rejected: HAS/USES must be stated'; END IF;

  fld := CASE WHEN :TARGET = 'SKT:sensitive' THEN 'sensitivity'
              WHEN ttype = 'SKIN_TYPE' THEN 'type'
              WHEN ttype = 'SKIN_TONE' THEN 'fitzpatrick'
              ELSE LOWER(ttype) END;

  MERGE INTO KG_NODE n USING (SELECT :SHOPPER id) s ON n.NODE_ID = s.id
    WHEN NOT MATCHED THEN INSERT (NODE_ID, NODE_TYPE, SOURCE) VALUES (s.id, 'SHOPPER', 'SESSION');

  IF (:EDGE_TYPE = 'HAS' AND fld = 'type') THEN
    UPDATE KG_EDGE SET STATUS = 'REJECTED', TS_INGESTED = CURRENT_TIMESTAMP()
    WHERE SRC_ID = :SHOPPER AND EDGE_TYPE = 'HAS' AND DST_ID <> :TARGET
      AND STATUS IN ('ASSERTED','ACCEPTED')
      AND DST_ID IN (SELECT NODE_ID FROM KG_NODE WHERE NODE_TYPE = 'SKIN_TYPE' AND NODE_ID <> 'SKT:sensitive');
  END IF;

  MERGE INTO KG_EDGE e
  USING (SELECT :SHOPPER src, :TARGET dst, :EDGE_TYPE et) a
    ON e.SRC_ID = a.src AND e.DST_ID = a.dst AND e.EDGE_TYPE = a.et
  WHEN MATCHED THEN UPDATE SET
    CONFIDENCE = IFF(:ORIGIN = 'STATED', :CONFIDENCE, GREATEST(COALESCE(e.CONFIDENCE, 0), :CONFIDENCE)),
    STATUS = IFF(:ORIGIN = 'STATED', 'ASSERTED', e.STATUS),
    PROPS = OBJECT_INSERT(OBJECT_INSERT(COALESCE(e.PROPS, OBJECT_CONSTRUCT()),
              'source', IFF(:ORIGIN = 'STATED', 'on_site', 'on_site_behavior'), TRUE),
              'observed_at', TO_VARCHAR(CURRENT_DATE()), TRUE),
    TS_INGESTED = CURRENT_TIMESTAMP()
  WHEN NOT MATCHED THEN INSERT (EDGE_ID, SRC_ID, DST_ID, EDGE_TYPE, PROPS, SOURCE, STATUS, CONFIDENCE)
    VALUES (MD5(a.src || a.dst || a.et), a.src, a.dst, a.et,
            OBJECT_CONSTRUCT('field', :fld,
                             'source', IFF(:ORIGIN = 'STATED', 'on_site', 'on_site_behavior'),
                             'observed_at', TO_VARCHAR(CURRENT_DATE())),
            IFF(:ORIGIN = 'STATED', 'SESSION', 'INFERRED'),
            IFF(:ORIGIN = 'STATED', 'ASSERTED', 'PROPOSED'),
            :CONFIDENCE);
  RETURN 'saved ' || :EDGE_TYPE || ' ' || :TARGET;
END;
$$;

-- Shopper says a fact no longer holds. Kept as REJECTED for history.
CREATE OR REPLACE PROCEDURE TOOL_RETRACT_FACT(SHOPPER STRING, EDGE_TYPE STRING, TARGET STRING)
RETURNS STRING LANGUAGE SQL AS
$$
BEGIN
  UPDATE KG_EDGE SET STATUS = 'REJECTED', TS_INGESTED = CURRENT_TIMESTAMP(),
    PROPS = OBJECT_INSERT(COALESCE(PROPS, OBJECT_CONSTRUCT()), 'retracted_at', TO_VARCHAR(CURRENT_DATE()), TRUE)
  WHERE SRC_ID = :SHOPPER AND EDGE_TYPE = :EDGE_TYPE AND DST_ID = :TARGET
    AND STATUS IN ('ASSERTED','ACCEPTED','PROPOSED');
  RETURN IFF(SQLROWCOUNT > 0, 'retracted ' || :EDGE_TYPE || ' ' || :TARGET, 'nothing to retract');
END;
$$;

-- Shopper clicked "Yes, still right": refresh date + confidence on skin facts.
CREATE OR REPLACE PROCEDURE TOOL_CONFIRM_PROFILE(SHOPPER STRING)
RETURNS STRING LANGUAGE SQL AS
$$
BEGIN
  UPDATE KG_EDGE SET
    CONFIDENCE = GREATEST(COALESCE(CONFIDENCE, 0), 0.95),
    PROPS = OBJECT_INSERT(OBJECT_INSERT(COALESCE(PROPS, OBJECT_CONSTRUCT()),
              'source', 'confirmed_on_site', TRUE), 'observed_at', TO_VARCHAR(CURRENT_DATE()), TRUE),
    TS_INGESTED = CURRENT_TIMESTAMP()
  WHERE SRC_ID = :SHOPPER AND EDGE_TYPE = 'HAS' AND STATUS IN ('ASSERTED','ACCEPTED')
    AND DST_ID IN (SELECT NODE_ID FROM KG_NODE WHERE NODE_TYPE IN ('SKIN_TYPE','SKIN_TONE'));
  RETURN 'confirmed ' || SQLROWCOUNT || ' facts';
END;
$$;

-- Active facts only, so the agent knows what it can retract.
CREATE OR REPLACE PROCEDURE TOOL_GET_PROFILE(SHOPPER STRING)
RETURNS VARIANT LANGUAGE SQL AS
$$
DECLARE r VARIANT;
BEGIN
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('edge', e.EDGE_TYPE, 'id', e.DST_ID, 'type', n.NODE_TYPE, 'name', n.NAME,
                   'status', e.STATUS, 'confidence', e.CONFIDENCE)) INTO :r
  FROM KG_EDGE e JOIN KG_NODE n ON n.NODE_ID = e.DST_ID
  WHERE e.SRC_ID = :SHOPPER AND e.STATUS IN ('ASSERTED','ACCEPTED','PROPOSED');
  RETURN r;
END;
$$;

CREATE OR REPLACE PROCEDURE TOOL_LIST_VOCAB()
RETURNS VARIANT LANGUAGE SQL AS
$$
DECLARE r VARIANT;
BEGIN
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('id', NODE_ID, 'type', NODE_TYPE, 'name', NAME)) INTO :r
  FROM KG_NODE WHERE NODE_TYPE IN ('INGREDIENT','CONCERN','SKIN_TYPE','SKIN_TONE','CONDITION','GOAL');
  RETURN r;
END;
$$;

-- Scalar profile fields on the SHOPPER node (not edges). Whitelisted keys only.
CREATE OR REPLACE PROCEDURE TOOL_SET_ATTRIBUTE(SHOPPER STRING, ATTR STRING, VAL STRING)
RETURNS STRING LANGUAGE SQL AS
$$
BEGIN
  IF (:ATTR NOT IN ('age_band','climate')) THEN RETURN 'rejected: key must be age_band or climate'; END IF;
  IF (:ATTR = 'age_band' AND NOT RLIKE(:VAL, '^[0-9]{2}-[0-9]{2}$')) THEN
    RETURN 'rejected: age_band must look like 18-31';
  END IF;
  IF (:ATTR = 'climate' AND NOT RLIKE(:VAL, '^[a-z_]{3,30}$')) THEN
    RETURN 'rejected: climate must be lower_snake_case, e.g. coastal_mild';
  END IF;
  UPDATE KG_NODE SET PROPS = OBJECT_INSERT(OBJECT_INSERT(COALESCE(PROPS, OBJECT_CONSTRUCT()),
                       :ATTR, :VAL, TRUE), :ATTR || '_observed_at', TO_VARCHAR(CURRENT_DATE()), TRUE)
  WHERE NODE_ID = :SHOPPER AND NODE_TYPE = 'SHOPPER';
  RETURN IFF(SQLROWCOUNT > 0, 'saved ' || :ATTR || '=' || :VAL, 'rejected: unknown shopper');
END;
$$;

CREATE OR REPLACE AGENT CDP_AGENT
  COMMENT = 'Agent CDP v2: turns on-site events into writes on the personal KG'
  FROM SPECIFICATION
$$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 20
    tokens: 6000

instructions:
  orchestration: >
    Your only job is to keep the shopper's personal knowledge graph correct.
    Each user message is one JSON event: {shopper_id, product_id, event_type, payload}.
    1) Always call log_event first.
    2) CONFIRM: call confirm_profile. Do nothing else.
    3) ANSWER: call record_answer with payload.question_id and payload.answer.
    4) INTEREST: call upsert_fact with edge INTERESTED_IN, target payload.target,
       origin INFERRED, confidence 0.3.
    5) FREE_TEXT: call get_profile and list_vocab. Split payload.text into separate statements.
       For each new or changed fact, call upsert_fact with origin STATED and confidence 1.0
       (skin type -> HAS SKT:*, concern -> HAS CON:*, condition -> HAS CND:*,
       ingredient they use -> USES ING:*, goal -> WANTS GOAL:*).
       For each fact the shopper says no longer holds, call retract_fact on the matching
       active fact from get_profile. A new skin type replaces the old one automatically.
       Skin type rule: any statement that the skin is or feels dry, oily, combination or normal
       is a skin type statement. If it differs from the active HAS SKT:* fact, call upsert_fact
       HAS with that SKT id, even if a matching concern exists. "Sensitive" is HAS SKT:sensitive.
       Age band and climate are not nodes: call set_attribute (age_band like "18-31",
       climate in lower_snake_case like "coastal_mild" or "hot_humid").
       Use only node ids from list_vocab or get_profile. Never invent ids.
       If a statement has no matching node, add it to skipped.
    Never infer HAS or USES from behavior. Do not give product advice.
  response: >
    Return only JSON, no prose:
    {"writes": [{"op": "upsert|retract|confirm|answer|set", "edge": "HAS", "target": "SKT:oily"}],
    For set, use {"op": "set", "edge": "age_band", "target": "18-31"}.
     "skipped": [short strings]}.
    List only writes whose tool call succeeded. If there are no writes, give the reason in skipped.

tools:
  - tool_spec:
      type: generic
      name: log_event
      description: Store the raw event.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          product: {type: string}
          event_type: {type: string}
          payload: {type: string, description: "payload as JSON string"}
        required: [shopper, product, event_type, payload]
  - tool_spec:
      type: generic
      name: upsert_fact
      description: Add or update one fact on the shopper. Returns 'saved ...' or 'rejected ...'.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          edge_type: {type: string, description: "HAS | USES | INTERESTED_IN | WANTS"}
          target: {type: string, description: "node id from list_vocab or get_profile"}
          origin: {type: string, description: "STATED or INFERRED"}
          confidence: {type: number}
        required: [shopper, edge_type, target, origin, confidence]
  - tool_spec:
      type: generic
      name: retract_fact
      description: Mark an active fact as no longer true.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          edge_type: {type: string}
          target: {type: string}
        required: [shopper, edge_type, target]
  - tool_spec:
      type: generic
      name: confirm_profile
      description: Shopper confirmed their skin profile is still right. Refreshes date and confidence.
      input_schema:
        type: object
        properties: {shopper: {type: string}}
        required: [shopper]
  - tool_spec:
      type: generic
      name: record_answer
      description: Save the shopper's yes/no answer to a known question.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          question: {type: string}
          answer: {type: string}
        required: [shopper, question, answer]
  - tool_spec:
      type: generic
      name: set_attribute
      description: Set a scalar profile field on the shopper. Keys age_band or climate only.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          attr: {type: string, description: "age_band | climate"}
          val: {type: string, description: "age_band like 18-31; climate like coastal_mild"}
        required: [shopper, attr, val]
  - tool_spec:
      type: generic
      name: get_profile
      description: The shopper's active facts.
      input_schema:
        type: object
        properties: {shopper: {type: string}}
        required: [shopper]
  - tool_spec:
      type: generic
      name: list_vocab
      description: Valid ingredient, concern, skin type, skin tone, condition and goal ids.
      input_schema:
        type: object
        properties: {}

tool_resources:
  log_event:       {type: procedure, identifier: SKINCARE_KG.KG.TOOL_LOG_EVENT,       execution_environment: {type: warehouse, warehouse: KG_WH}}
  upsert_fact:     {type: procedure, identifier: SKINCARE_KG.KG.TOOL_UPSERT_FACT,     execution_environment: {type: warehouse, warehouse: KG_WH}}
  retract_fact:    {type: procedure, identifier: SKINCARE_KG.KG.TOOL_RETRACT_FACT,    execution_environment: {type: warehouse, warehouse: KG_WH}}
  confirm_profile: {type: procedure, identifier: SKINCARE_KG.KG.TOOL_CONFIRM_PROFILE, execution_environment: {type: warehouse, warehouse: KG_WH}}
  record_answer:   {type: procedure, identifier: SKINCARE_KG.KG.TOOL_RECORD_ANSWER,   execution_environment: {type: warehouse, warehouse: KG_WH}}
  set_attribute:   {type: procedure, identifier: SKINCARE_KG.KG.TOOL_SET_ATTRIBUTE,   execution_environment: {type: warehouse, warehouse: KG_WH}}
  get_profile:     {type: procedure, identifier: SKINCARE_KG.KG.TOOL_GET_PROFILE,     execution_environment: {type: warehouse, warehouse: KG_WH}}
  list_vocab:      {type: procedure, identifier: SKINCARE_KG.KG.TOOL_LIST_VOCAB,      execution_environment: {type: warehouse, warehouse: KG_WH}}
$$;

-- ---------- Smoke test (SQL only, no LLM) ---------- (commented out: it changes the demo shopper's skin type)
-- CALL TOOL_UPSERT_FACT('SHP:customer_003', 'HAS', 'SKT:oily', 'STATED', 1.0);
-- SELECT DST_ID, STATUS, PROPS FROM KG_EDGE
-- WHERE SRC_ID = 'SHP:customer_003' AND DST_ID IN ('SKT:dry','SKT:oily');   -- dry REJECTED, oily ASSERTED
-- CALL TOOL_UPSERT_FACT('SHP:customer_003', 'HAS', 'SKT:dry', 'STATED', 0.7);  -- restore for the demo
