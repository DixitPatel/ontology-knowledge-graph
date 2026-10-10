# Handoff: Skincare KG + Cortex Agent CDP (Coframe hackathon MVP)

Date: 2026-10-10. Owner: Dixit. Deadline: demo today.

## Goal
A shopper-led product page has an "Am I for you?" tab. The tab sends events to a
Snowflake Cortex Agent (`CDP_AGENT`). The agent updates a personal knowledge graph
and returns a verdict, reasons, the next question and routine conflicts. The tab
renders the next UI module from that JSON.

## Architecture
```
Tab (browser) --POST /event--> agent_proxy.py (localhost:8787, signs JWT)
                                   |--> CDP_AGENT:run  (LLM path: free text, clicks, dwell)
              --POST /answer-->    |--> SQL API CALL RECORD_ANSWER (fast path: yes/no)
CDP_AGENT tools = stored procs over SKINCARE_KG.KG.KG_NODE / KG_EDGE
```
- Ontology = node types + edge types. KG = rows in KG_NODE / KG_EDGE.
- Model follows Snowflake-Labs/ontology-on-snowflake (generic node/edge tables).
- Stated facts: STATUS='ASSERTED'. Inferred facts: STATUS='PROPOSED' with CONFIDENCE.

## Files
| File | Purpose |
|---|---|
| `skincare_kg.sql` | DB, KG_NODE/KG_EDGE, seed data, view PRODUCT_ATTR, RECORD_ANSWER, RANK_PRODUCTS, NEXT_QUESTION, ROUTINE_CONFLICTS, smoke test |
| `cdp_agent.sql` | EVENT_LOG, TOOL_* procedures, CDP_AGENT spec, views PROFILE_LIVE and EVENT_FEED, smoke test |
| `agent_proxy.py` | FastAPI proxy. `/event` streams agent SSE. `/answer` is the fast path. `/health` |

## Graph schema
Node types: PRODUCT, INGREDIENT, CONCERN, SKIN_TYPE, CONDITION, QUESTION, SHOPPER.
ID prefixes: `PRD:`, `ING:`, `CON:`, `SKT:`, `CND:`, `Q:`, `SHP:`.

Edges:
- PRODUCT -CONTAINS-> INGREDIENT (PROPS.pct)
- PRODUCT -SUITS-> SKIN_TYPE
- INGREDIENT -TREATS-> CONCERN (WEIGHT = evidence 0..1)
- INGREDIENT -AVOID_WITH-> CONDITION | SKIN_TYPE (WEIGHT >= 0.7 blocks the product)
- INGREDIENT -CONFLICTS_WITH-> INGREDIENT
- QUESTION -ASKS_ABOUT-> CONCERN | SKIN_TYPE | CONDITION
- SHOPPER -HAS | USES | INTERESTED_IN-> node (this is the CDP profile)

## Snowflake account
- Account RS56916, locator BJ02107, Enterprise, AWS US East (Ohio) = us-east-2.
- Probably a trial (created ~2026-09-28). Cortex needs a credit card on file.
- us-east-2 is not a native Cortex Analyst region. Cross-region inference is required.
- Role KG_DEV, warehouse KG_WH (XS, auto-suspend 60 s).
- Auth: key pair, `~/.snowflake/keys/rsa_key.p8` (no passphrase), connection `kg`
  in `~/.snowflake/connections.toml`.

## Current state (updated 2026-10-10, see docs/progress.md for full evidence)
- [x] SQL scripts written
- [x] Proxy written
- [x] Account setup, KG load, agent load, agent test, and proxy all run and verified live
  (one bug fixed in NEXT_QUESTION's FLOAT cast; proxy moved to port 8788, not 8787 —
  the Shopify backend already owns 8787 on this machine)
- [x] Tab emits events to the proxy and renders verdict/reasons/next_question/conflicts
  in a debug panel (`am-i-for-you-cdp.js`) — minimal wiring only, not the full UI
  integration described in Task 7; no real product-catalog ↔ PRD: id mapping yet

## Tasks (do in order; stop and report on first failure)
1. **Account setup** (ACCOUNTADMIN, Snowsight):
   ```sql
   ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION='AWS_US';
   -- create KG_WH, KG_DEV, grants, CORTEX_USER, user defaults (see chat step 1)
   SELECT AI_COMPLETE('claude-4-sonnet','ping');
   ```
   Pass: AI_COMPLETE returns text. If not: tell Dixit to add a card (Admin > Billing).
2. **Local CLI:** `snow connection test -c kg`. Pass: success.
3. **Load KG:** `snow sql -c kg -f skincare_kg.sql`.
   Pass: the smoke test shows Bright Spot Serum on top and Night Renew Serum BLOCKED
   for SHP:demo. NEXT_QUESTION returns one row.
4. **Load agent:** `snow sql -c kg -f cdp_agent.sql`, then
   `SHOW AGENTS IN SCHEMA SKINCARE_KG.KG`. Pass: CDP_AGENT is listed.
   Run `GRANT USAGE ON DATABASE SKINCARE_KG TO ROLE KG_DEV` and the same for the
   schema if the owner role differs.
5. **Agent test in Snowsight** (AI & ML > Agents > CDP_AGENT) with:
   `{"shopper_id":"SHP:demo2","product_id":"PRD:night","event_type":"FREE_TEXT","payload":{"text":"I'm pregnant and I already use a glycolic toner"}}`
   Pass: verdict `not_for_you`. PROFILE_LIVE shows HAS CND:pregnant and USES ING:glycolic.
6. **Proxy:**
   ```bash
   pip install fastapi uvicorn httpx pyjwt cryptography
   SF_ACCOUNT=<org-account> SF_USER=<user> uvicorn agent_proxy:app --port 8787
   curl localhost:8787/health
   ```
   Then send the step 5 event with curl to `/event`. Pass: the SSE stream ends with the verdict JSON.
   Then test `/answer` with `{"shopper_id":"SHP:demo4","question_id":"Q:acne","answer":"yes"}`.
7. **Tab integration:** the tab posts events to `/event`, yes/no answers to `/answer`,
   and renders `verdict`, `reasons`, `next_question`, `conflicts`.
   Optional: `ngrok http 8787` for a public URL.

## Known risks / check first
- The agent spec YAML (generic tools, `type: procedure`) is written from docs and has
  not been run. If CREATE AGENT fails, check the tool_resources syntax against
  https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-rest-api
- `:run` endpoint path and request body format are not verified live. If 404,
  check the Cortex Agents "run" REST docs.
- Model name `claude-4-sonnet` may differ. Use `SHOW` / docs model table, or `auto`.
- Stored procs called as agent tools: argument names must match input_schema property
  names (shopper, product, question, ...). Fix the names if the agent passes nulls.
- Caller's rights vs owner's rights: procs default to owner's rights. This is fine
  while KG_DEV owns everything.
- Snowflake does not enforce primary keys. MERGE logic prevents duplicate edges.
- The private key has no passphrase. Rotate it after the event.
- Seed data is demo data. Do not present ingredient facts as medical claims.

## Out of scope today
Jev confidence gate, external access integrations (trial blocks egress), cancer KG,
real product catalog load.

## Demo script
1. New shopper opens the tab. Show the next question from NEXT_QUESTION.
2. Shopper types "I'm pregnant and use a glycolic toner".
3. Verdict flips to not_for_you, with reasons and the conflict.
4. Second screen: PROFILE_LIVE and EVENT_FEED update live.
5. Reload as the same shopper: the profile is already there (zero-party CDP).
