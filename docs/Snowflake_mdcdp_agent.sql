-- =====================================================
-- CDP AGENT for the "Am I for you?" tab
-- Run after skincare_kg.sql. Same schema: SKINCARE_KG.KG
-- Flow: tab event -> agent:run -> agent picks tools -> KG updated
-- =====================================================
USE SCHEMA SKINCARE_KG.KG;

-- ---------- 1. Raw event log (every event, before interpretation) ----------
CREATE OR REPLACE TABLE EVENT_LOG (
  EVENT_ID    STRING DEFAULT UUID_STRING(),
  SHOPPER_ID  STRING,
  PRODUCT_ID  STRING,
  EVENT_TYPE  STRING,      -- ANSWER | FREE_TEXT | CLICK | DWELL | ADD_TO_CART
  PAYLOAD     VARIANT,
  TS          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ---------- 2. Tool procedures (agent tools must be procs/UDFs) ----------
CREATE OR REPLACE PROCEDURE TOOL_LOG_EVENT(SHOPPER STRING, PRODUCT STRING, EVENT_TYPE STRING, PAYLOAD STRING)
RETURNS STRING LANGUAGE SQL AS
$$
BEGIN
  INSERT INTO EVENT_LOG (SHOPPER_ID, PRODUCT_ID, EVENT_TYPE, PAYLOAD)
    SELECT :SHOPPER, :PRODUCT, :EVENT_TYPE, TRY_PARSE_JSON(:PAYLOAD);
  RETURN 'logged';
END;
$$;

-- Stated fact (shopper said it): wraps RECORD_ANSWER
CREATE OR REPLACE PROCEDURE TOOL_RECORD_ANSWER(SHOPPER STRING, QUESTION STRING, ANSWER STRING)
RETURNS STRING LANGUAGE SQL AS
$$ BEGIN CALL RECORD_ANSWER(:SHOPPER, :QUESTION, :ANSWER); RETURN 'saved'; END; $$;

-- Fact from free text or behavior. STATED -> ASSERTED; INFERRED -> PROPOSED with confidence.
CREATE OR REPLACE PROCEDURE TOOL_UPSERT_FACT(SHOPPER STRING, EDGE_TYPE STRING, TARGET STRING,
                                             ORIGIN STRING, CONFIDENCE FLOAT)
RETURNS STRING LANGUAGE SQL AS
$$
BEGIN
  IF (:EDGE_TYPE NOT IN ('HAS','USES','INTERESTED_IN')) THEN RETURN 'rejected: bad edge type'; END IF;
  IF (NOT EXISTS (SELECT 1 FROM KG_NODE WHERE NODE_ID=:TARGET)) THEN RETURN 'rejected: unknown node'; END IF;
  MERGE INTO KG_NODE n USING (SELECT :SHOPPER id) s ON n.NODE_ID=s.id
    WHEN NOT MATCHED THEN INSERT (NODE_ID, NODE_TYPE, SOURCE) VALUES (s.id,'SHOPPER','SESSION');
  MERGE INTO KG_EDGE e
  USING (SELECT :SHOPPER src, :TARGET dst, :EDGE_TYPE et) a
    ON e.SRC_ID=a.src AND e.DST_ID=a.dst AND e.EDGE_TYPE=a.et
  WHEN MATCHED THEN UPDATE SET
    CONFIDENCE = GREATEST(COALESCE(e.CONFIDENCE,0), :CONFIDENCE),
    STATUS = IFF(:ORIGIN='STATED','ASSERTED', e.STATUS),
    TS_INGESTED = CURRENT_TIMESTAMP()
  WHEN NOT MATCHED THEN INSERT (EDGE_ID,SRC_ID,DST_ID,EDGE_TYPE,PROPS,SOURCE,STATUS,CONFIDENCE)
    VALUES (MD5(a.src||a.dst||a.et), a.src, a.dst, a.et,
            OBJECT_CONSTRUCT('answer','yes'),
            IFF(:ORIGIN='STATED','SESSION','INFERRED'),
            IFF(:ORIGIN='STATED','ASSERTED','PROPOSED'),
            :CONFIDENCE);
  RETURN 'saved';
END;
$$;

CREATE OR REPLACE PROCEDURE TOOL_GET_PROFILE(SHOPPER STRING)
RETURNS VARIANT LANGUAGE SQL AS
$$
DECLARE r VARIANT;
BEGIN
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('edge',e.EDGE_TYPE,'node',n.NAME,'id',e.DST_ID,
                   'answer',e.PROPS:answer,'status',e.STATUS,'confidence',e.CONFIDENCE)) INTO :r
  FROM KG_EDGE e JOIN KG_NODE n ON n.NODE_ID=e.DST_ID WHERE e.SRC_ID=:SHOPPER;
  RETURN r;
END;
$$;

CREATE OR REPLACE PROCEDURE TOOL_RANK_PRODUCTS(SHOPPER STRING)
RETURNS VARIANT LANGUAGE SQL AS
$$
DECLARE r VARIANT;
BEGIN
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) WITHIN GROUP (ORDER BY BLOCKED, FIT DESC) INTO :r
  FROM TABLE(RANK_PRODUCTS(:SHOPPER));
  RETURN r;
END;
$$;

CREATE OR REPLACE PROCEDURE TOOL_NEXT_QUESTION(SHOPPER STRING)
RETURNS VARIANT LANGUAGE SQL AS
$$
DECLARE r VARIANT;
BEGIN
  SELECT OBJECT_CONSTRUCT(*) INTO :r FROM TABLE(NEXT_QUESTION(:SHOPPER));
  RETURN r;
END;
$$;

CREATE OR REPLACE PROCEDURE TOOL_ROUTINE_CONFLICTS(SHOPPER STRING, PRODUCT STRING)
RETURNS VARIANT LANGUAGE SQL AS
$$
DECLARE r VARIANT;
BEGIN
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) INTO :r FROM TABLE(ROUTINE_CONFLICTS(:SHOPPER, :PRODUCT));
  RETURN r;
END;
$$;

-- Vocabulary lookup so the agent maps free text to valid node IDs
CREATE OR REPLACE PROCEDURE TOOL_LIST_VOCAB()
RETURNS VARIANT LANGUAGE SQL AS
$$
DECLARE r VARIANT;
BEGIN
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('id',NODE_ID,'type',NODE_TYPE,'name',NAME)) INTO :r
  FROM KG_NODE WHERE NODE_TYPE IN ('INGREDIENT','CONCERN','SKIN_TYPE','CONDITION','QUESTION');
  RETURN r;
END;
$$;

-- ---------- 3. The agent ----------
CREATE OR REPLACE AGENT CDP_AGENT
  COMMENT = 'Agent CDP: interprets Am-I-for-you events and updates the personal KG'
  FROM SPECIFICATION
$$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 20
    tokens: 8000

instructions:
  orchestration: >
    Each user message is one JSON event from the "Am I for you?" tab:
    {shopper_id, product_id, event_type, payload}.
    Always: 1) call log_event first.
    2) ANSWER event: call record_answer with payload.question_id and payload.answer.
    3) FREE_TEXT event: call list_vocab, map the text to node IDs, then call upsert_fact
       with origin STATED and confidence 1.0 for facts the shopper said
       (e.g. "I use retinol" -> USES ING:retinol; "I'm pregnant" -> HAS CND:pregnant).
       Never invent node IDs.
    4) CLICK or DWELL on an ingredient or concern: call upsert_fact with edge INTERESTED_IN,
       origin INFERRED, confidence 0.3 for a click and 0.5 for dwell over 10 seconds.
       Never infer HAS or CONDITION facts from behavior.
    5) Then call rank_products and next_question. If the product is in the ranked list,
       call routine_conflicts for it.
  response: >
    Return only JSON:
    {"verdict": "good_fit|caution|not_for_you|need_more_info",
     "reasons": [short strings], "next_question": {"id": "...", "text": "..."} or null,
     "conflicts": [...]}.
    Base the verdict only on tool output for payload product. No medical claims.

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
      name: record_answer
      description: Save the shopper's answer to a known question.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          question: {type: string, description: "QUESTION node id, e.g. Q:acne"}
          answer: {type: string, description: "yes or no"}
        required: [shopper, question, answer]
  - tool_spec:
      type: generic
      name: upsert_fact
      description: Add or strengthen a fact in the shopper profile.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          edge_type: {type: string, description: "HAS | USES | INTERESTED_IN"}
          target: {type: string, description: "existing node id from list_vocab"}
          origin: {type: string, description: "STATED or INFERRED"}
          confidence: {type: number}
        required: [shopper, edge_type, target, origin, confidence]
  - tool_spec:
      type: generic
      name: get_profile
      description: Read the shopper's current profile.
      input_schema:
        type: object
        properties: {shopper: {type: string}}
        required: [shopper]
  - tool_spec:
      type: generic
      name: rank_products
      description: Fit score, blocked flag, and reasons for every product.
      input_schema:
        type: object
        properties: {shopper: {type: string}}
        required: [shopper]
  - tool_spec:
      type: generic
      name: next_question
      description: The most informative unanswered question.
      input_schema:
        type: object
        properties: {shopper: {type: string}}
        required: [shopper]
  - tool_spec:
      type: generic
      name: routine_conflicts
      description: Clashes between the shopper's routine and a product.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          product: {type: string}
        required: [shopper, product]
  - tool_spec:
      type: generic
      name: list_vocab
      description: Valid ingredient, concern, skin type, condition and question IDs.
      input_schema:
        type: object
        properties: {}

tool_resources:
  log_event:         {type: procedure, identifier: SKINCARE_KG.KG.TOOL_LOG_EVENT,         execution_environment: {type: warehouse, warehouse: KG_WH}}
  record_answer:     {type: procedure, identifier: SKINCARE_KG.KG.TOOL_RECORD_ANSWER,     execution_environment: {type: warehouse, warehouse: KG_WH}}
  upsert_fact:       {type: procedure, identifier: SKINCARE_KG.KG.TOOL_UPSERT_FACT,       execution_environment: {type: warehouse, warehouse: KG_WH}}
  get_profile:       {type: procedure, identifier: SKINCARE_KG.KG.TOOL_GET_PROFILE,       execution_environment: {type: warehouse, warehouse: KG_WH}}
  rank_products:     {type: procedure, identifier: SKINCARE_KG.KG.TOOL_RANK_PRODUCTS,     execution_environment: {type: warehouse, warehouse: KG_WH}}
  next_question:     {type: procedure, identifier: SKINCARE_KG.KG.TOOL_NEXT_QUESTION,     execution_environment: {type: warehouse, warehouse: KG_WH}}
  routine_conflicts: {type: procedure, identifier: SKINCARE_KG.KG.TOOL_ROUTINE_CONFLICTS, execution_environment: {type: warehouse, warehouse: KG_WH}}
  list_vocab:        {type: procedure, identifier: SKINCARE_KG.KG.TOOL_LIST_VOCAB,        execution_environment: {type: warehouse, warehouse: KG_WH}}
$$;

-- ---------- 4. Monitor views ----------
CREATE OR REPLACE VIEW PROFILE_LIVE AS
SELECT e.SRC_ID SHOPPER_ID, e.EDGE_TYPE, n.NODE_TYPE, n.NAME, e.STATUS, e.CONFIDENCE, e.TS_INGESTED
FROM KG_EDGE e JOIN KG_NODE n ON n.NODE_ID=e.DST_ID
WHERE e.SRC_ID LIKE 'SHP:%';

CREATE OR REPLACE VIEW EVENT_FEED AS
SELECT * FROM EVENT_LOG ORDER BY TS DESC;

-- ---------- 5. Smoke test (SQL path, no UI) ----------
-- Check that tools work directly:
CALL TOOL_UPSERT_FACT('SHP:demo2','USES','ING:glycolic','STATED',1.0);
CALL TOOL_RANK_PRODUCTS('SHP:demo2');
-- Then test the agent in Snowsight: AI & ML > Agents > CDP_AGENT, send:
-- {"shopper_id":"SHP:demo2","product_id":"PRD:night","event_type":"FREE_TEXT",
--  "payload":{"text":"I'm pregnant and I already use a glycolic toner"}}
-- Expect: verdict not_for_you (retinol + pregnant; retinol conflicts with glycolic).
SELECT * FROM PROFILE_LIVE WHERE SHOPPER_ID='SHP:demo2';
