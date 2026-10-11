-- =====================================================
-- FIT_AGENT: read-only "Is this right for you?" answer.
-- docs/AgentCDP/HANDOFF-fit-agent.md, Tasks 2-3. Run after
-- Snowflake_fit_data.sql. Separate from CDP_AGENT (write) and the
-- writer agent (docs/Snowflake_agent_writer.sql) -- read and write
-- stay different agents.
-- =====================================================
USE SCHEMA SKINCARE_KG.KG;

-- ---------- 1. TOOL_PRODUCT_FACTS ----------
CREATE OR REPLACE PROCEDURE TOOL_PRODUCT_FACTS(PRODUCT STRING)
RETURNS VARIANT LANGUAGE SQL AS
$$
DECLARE r VARIANT;
BEGIN
  r := (
    WITH ingredient_edges AS (
      SELECT e.DST_ID AS ing_id, n.NAME AS ing_name, e.PROPS AS props
      FROM KG_EDGE e JOIN KG_NODE n ON n.NODE_ID = e.DST_ID
      WHERE e.SRC_ID = :PRODUCT AND e.EDGE_TYPE = 'CONTAINS'
    ),
    rules AS (
      -- TREATS/AVOID_WITH are directional (ingredient -> concern/condition),
      -- so SRC-only is correct. CONFLICTS_WITH is ingredient<->ingredient and
      -- stored one-directionally in the seed (e.g. retinol->glycolic), so it
      -- must match either side -- same rule ROUTINE_CONFLICTS already uses.
      SELECT ie.ing_id AS ingredient, rl.EDGE_TYPE AS edge,
             IFF(rl.SRC_ID = ie.ing_id, rl.DST_ID, rl.SRC_ID) AS target,
             rl.WEIGHT AS weight, rl.PROPS AS props
      FROM ingredient_edges ie
      JOIN KG_EDGE rl ON
        (rl.EDGE_TYPE IN ('TREATS', 'AVOID_WITH') AND rl.SRC_ID = ie.ing_id)
        OR (rl.EDGE_TYPE = 'CONFLICTS_WITH' AND (rl.SRC_ID = ie.ing_id OR rl.DST_ID = ie.ing_id))
    )
    SELECT OBJECT_CONSTRUCT(
      'product', :PRODUCT,
      'ingredients', (SELECT COALESCE(ARRAY_AGG(OBJECT_CONSTRUCT('id', ing_id, 'name', ing_name, 'props', props)), ARRAY_CONSTRUCT()) FROM ingredient_edges),
      'rules', (SELECT COALESCE(ARRAY_AGG(OBJECT_CONSTRUCT('ingredient', ingredient, 'edge', edge, 'target', target, 'weight', weight, 'props', props)), ARRAY_CONSTRUCT()) FROM rules)
    )
  );
  RETURN r;
END;
$$;

-- Gate: lists glycolic with AVOID_WITH SKT:sensitive, AVOID_WITH
-- CON:rosacea, and CONFLICTS_WITH ING:retinol.
CALL TOOL_PRODUCT_FACTS('PRD:store:glow-barrier-duo');

-- ---------- 2. Agent tool wrappers ----------
CREATE OR REPLACE PROCEDURE TOOL_FIT_PRODUCT_FACTS(PRODUCT STRING)
RETURNS VARIANT LANGUAGE SQL AS
$$ BEGIN RETURN TOOL_PRODUCT_FACTS(:PRODUCT); END; $$;

-- FIT_AGENT reuses the existing TOOL_GET_PROFILE / TOOL_ROUTINE_CONFLICTS
-- procs as-is (docs/Snowflake_mdcdp_agent.sql) -- no wrapper needed.

-- ---------- 3. The agent ----------
CREATE OR REPLACE AGENT FIT_AGENT
  COMMENT = 'Read-only: answers "Is this right for you?" from product facts, sourced guidance, and the shopper''s personal KG. Never writes.'
  FROM SPECIFICATION
$$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 25
    tokens: 8000

instructions:
  orchestration: >
    The user message is one JSON object: {shopper_id, product_id, panel_context, guidance}.
    panel_context is the shopper's own view of their profile (skin, concerns, goals, routine,
    avoid list) as already shown in the "Skin & Routine" tab. guidance is sourced general
    guidance text for this product (may be empty).
    Always call product_facts for product_id and get_profile for shopper_id.
    Call routine_conflicts for (shopper_id, product_id) only if get_profile shows any USES edges.
    Base every reason on a specific tool row or a specific guidance entry -- name the fact
    (e.g. "your graph: sensitive skin, rosacea"), never a generic claim.
    If an ingredient's strength or identity is approximate (props.as, props.strength = "unknown"),
    say so plainly (e.g. "AHA (e.g. glycolic acid)"), never state it as a confirmed fact.
    No medical claims, no diagnosis. Only suggest patch testing, sunscreen, or spacing from
    other actives, and only when a guidance entry or tool rule supports it.
  response: >
    Return only this JSON, no other text:
    {"verdict": "good_fit|caution|not_for_you|need_more_info",
     "headline": "one short sentence",
     "reasons": [{"text": "...", "basis": "kg|guidance|profile", "refs": ["ING:glycolic","CON:rosacea"]}],
     "if_you_try": ["..."],
     "sources": ["your skin graph", "fda_aha", "aad_products"]}

tools:
  - tool_spec:
      type: generic
      name: product_facts
      description: Ingredients the product contains and the ontology rules (TREATS/AVOID_WITH/CONFLICTS_WITH) attached to them.
      input_schema:
        type: object
        properties: {product: {type: string}}
        required: [product]
  - tool_spec:
      type: generic
      name: get_profile
      description: The shopper's current personal KG facts.
      input_schema:
        type: object
        properties: {shopper: {type: string}}
        required: [shopper]
  - tool_spec:
      type: generic
      name: routine_conflicts
      description: Clashes between the shopper's current routine (USES edges) and this product.
      input_schema:
        type: object
        properties:
          shopper: {type: string}
          product: {type: string}
        required: [shopper, product]

tool_resources:
  product_facts:     {type: procedure, identifier: SKINCARE_KG.KG.TOOL_FIT_PRODUCT_FACTS, execution_environment: {type: warehouse, warehouse: KG_WH}}
  get_profile:        {type: procedure, identifier: SKINCARE_KG.KG.TOOL_GET_PROFILE,       execution_environment: {type: warehouse, warehouse: KG_WH}}
  routine_conflicts:  {type: procedure, identifier: SKINCARE_KG.KG.TOOL_ROUTINE_CONFLICTS, execution_environment: {type: warehouse, warehouse: KG_WH}}
$$;

-- Gate: SHOW AGENTS lists FIT_AGENT.
SHOW AGENTS IN SCHEMA SKINCARE_KG.KG;
