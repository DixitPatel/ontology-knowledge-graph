# Handoff: "Is this right for you?" — personalized fit answer from a Cortex agent

Date: 2026-10-10. Owner: Dixit. Demo: today. Work in order. Stop and report on the first failed gate.

## Goal
Add a card **"Is this right for you?"** to the panel. Put it above the tab row (`Skin & Routine · Avoid & budget · Purchases`).
The card shows a real Cortex agent answer. The agent uses three inputs:
1. the product's ingredients and the ontology rules (KG),
2. sourced guidelines (`ontology/guidance.json`),
3. the shopper's personal KG (the same data the Skin & Routine tab shows).

Example answer (Glow Barrier Duo, shopper `SHP:customer_003`):
> **Use with caution.** This duo has an AHA exfoliant. Your graph says sensitive skin and rosacea, and your advisor said to avoid glycolic acid. AHA can also clash with the retinol you started. If you try it: patch test first, use it on nights without retinol, and use sunscreen daily. *Sources: your skin graph · FDA AHA guidance · AAD.*

The answer arrives async. The card shows a loading state first, then fills in. It must never block the panel.

## Current state (read before you start)
Uncommitted work from the previous session. Commit it first as its own commit:
- `docs/Snowflake_profile_seed.sql`: `SHP:customer_003` in the KG (HAS / WANTS / ROUTINE_STEP edges with provenance in PROPS).
- `docs/Snowflake_agent_writer.sql`: `CDP_AGENT` v2. Its only job is to write to the KG (`{writes, skipped}`). **Do not add the fit answer to this agent.** Make a separate agent.
- `docs/Snowflake_agent_proxy.py` (port **8788**): `GET /profile/{shopper}` (one SQL read, about 1.2 s), `POST /event` (writer agent, logs tool calls), `POST /answer`, `GET /health`.
- Panel: `getLiveContext()` in `am-i-for-you-view-model.js` reads `/profile`. `am-i-for-you-cdp.js` sends CONFIRM / FREE_TEXT / INTEREST to `/event`. `createPanel()` returns `update(vm)`, which redraws after a KG write.
- Tests: `npm run test:aify`, 11/11 pass.
- Verified live: the writer agent wrote `HAS SKT:oily` and `USES ING:retinol` from free text. The panel redraws.

Run commands from the repo root, with `source .venv-sf/bin/activate`. Snowflake connection: `snow sql -c kg`.
Restart the proxy after each proxy change:
`lsof -ti tcp:8788 | xargs kill; cd docs && SF_ACCOUNT=gkkkqjy-rs56916 SF_USER=dixitdpatel92 uvicorn Snowflake_agent_proxy:app --port 8788`
The theme runs at `http://127.0.0.1:9292` (`shopify theme dev`, hot reload). Test page: `/products/glow-barrier-duo`.
**Browser note:** the Claude desktop browser pane blocks requests from :9292 to other local ports. Test the panel in Chrome. You can test the proxy routes directly in the pane (same origin).

## Data gaps to fix first (the agent has nothing to reason over without them)
- The store products `PRD:store:glow-barrier-duo`, `PRD:store:smooth-operator-aha-serum` and `PRD:store:cloud-whip-moisturiser` are nodes with **no CONTAINS edges**. `backend/src/catalog.js` says the serum and the duo have `active_ingredients: "aha"`, strength unknown. The moisturiser has no actives.
- The KG has no AHA node. Map AHA to `ING:glycolic`, and say so in PROPS (`{"as":"aha","strength":"unknown"}`).
- There is no rule for rosacea. Add `ING:glycolic -AVOID_WITH-> CON:rosacea` with weight 0.6 and PROPS `{"source":"aad_products"}`. Keep weight below 0.7, so the product shows as caution, not blocked.
- The shopper's avoid list (`glycolic_acid`, advisor recommendation) is only in the seed JS. Add `SHP:customer_003 -AVOIDS-> ING:glycolic`, PROPS `{"reason":"advisor_recommendation"}`. Add it to `/profile` output and to the avoid-list mapping in `profileFromKg` only if it is quick. If not, leave it out.
- Guidelines: `ontology/guidance.json` → `by_product[handle]` has sourced text with `source` keys into `sources`. Do not load it into Snowflake. The proxy reads the file and puts the product's entries in the agent message.

## Tasks

### 1. KG facts — new file `docs/Snowflake_fit_data.sql` (idempotent MERGE)
Add the edges listed in "Data gaps": CONTAINS for the 2 AHA products, the rosacea AVOID_WITH, and the AVOIDS edge.
Gate: `SELECT * FROM KG_EDGE WHERE SRC_ID LIKE 'PRD:store:%'` returns 2 CONTAINS rows. The rosacea and AVOIDS edges exist.

### 2. Tool proc — `TOOL_PRODUCT_FACTS(PRODUCT)` (in a new file `docs/Snowflake_fit_agent.sql`)
Returns VARIANT: `{product, ingredients:[{id,name,props}], rules:[{ingredient, edge: TREATS|AVOID_WITH|CONFLICTS_WITH, target, weight, props}]}`.
- `rules` = every TREATS / AVOID_WITH / CONFLICTS_WITH edge whose SRC is one of the product's ingredients.
- Reuse the existing `TOOL_GET_PROFILE` and `TOOL_ROUTINE_CONFLICTS`. **Check first:** `ROUTINE_CONFLICTS` must see `USES ING:*` edges. Routine products are `ROUTINE_STEP` edges, so they are not seen. That is acceptable.
Gate: `CALL TOOL_PRODUCT_FACTS('PRD:store:glow-barrier-duo')` lists glycolic with AVOID_WITH SKT:sensitive, AVOID_WITH CON:rosacea and CONFLICTS_WITH ING:retinol.

### 3. New agent `FIT_AGENT` (same file)
Read-only. Tools: `product_facts`, `get_profile`, `routine_conflicts`. No write tools.
Orchestration instructions (adapt; keep them short):
- The message has `{shopper_id, product_id, panel_context, guidance}`. `panel_context` is the panel's view model (skin, concerns, goals, routine, avoid list). `guidance` is the sourced text for this product.
- Always call `product_facts` and `get_profile`. Call `routine_conflicts` when the profile has USES edges.
- Base every reason on a tool row or a guidance entry. Name the specific fact ("your graph: sensitive skin, rosacea").
- If ingredient strength is unknown, say so. Do not guess.
- No medical claims. No diagnosis. Advice is limited to patch testing, sunscreen and spacing products, and only when a guidance entry says it.

Response: JSON only:
```json
{"verdict":"good_fit|caution|not_for_you|need_more_info",
 "headline":"one short sentence",
 "reasons":[{"text":"...","basis":"kg|guidance|profile","refs":["ING:glycolic","CON:rosacea"]}],
 "if_you_try":["..."],
 "sources":["your skin graph","fda_aha","aad_products"]}
```
Gate: in Snowsight or through the proxy (task 4), the Glow Barrier Duo answer for `SHP:customer_003` is `caution` or `not_for_you`. Its reasons cite sensitive or rosacea, plus the retinol conflict (needs `USES ING:retinol`, which exists from the earlier test).

### 4. Proxy route — `POST /fit` in `docs/Snowflake_agent_proxy.py`
Body: `{shopper_id, product_handle, panel_context}`.
- `product_id = "PRD:store:" + product_handle`. Load `ontology/guidance.json` once at startup. Attach `guidance.by_product[handle]` and the `sources` it references, or `{}`.
- Call `.../agents/FIT_AGENT:run`. Do not stream to the browser. Buffer the reply, parse the final `response.text` JSON, and return `{answer, ms}`.
- Reuse `log_agent_trace()` so tool calls show in uvicorn.
- Parse errors and timeouts return `{"answer": null, "error": "..."}` with HTTP 200, so the UI can show a fallback.
Gate: `curl -s localhost:8788/fit -H 'content-type: application/json' -d '{"shopper_id":"SHP:customer_003","product_handle":"glow-barrier-duo","panel_context":{}}'` returns the JSON from task 3.

### 5. Panel card — new `theme/assets/am-i-for-you-section-fit.js`
- Placement: between `.aify-head` and `.aify-tabs` in `createPanel()`. It shows on every tab. Hide it while `.aify-loading` shows. Add `data-cf-slot="fit"`.
- States:
  - `loading`: title "Is this right for you?" plus a shimmer line "Checking this product against your skin graph…"
  - `ready`: verdict pill + headline + reasons list + "If you try it" list + sources line
  - `error`: "We couldn't check this right now." and a Retry button
- Verdict pill colors: use the existing tokens. `caution` and `not_for_you` use `--aify-warn` / `--aify-warn-soft`. `good_fit` uses `--aify-brand-soft`. No new colors.
- Fetch starts at page init, not on panel open. Put it in `am-i-for-you.js` next to `getLiveContext()`, so the answer is usually ready by the time the 10 s loading bar ends. Send `panel_context` = the view model (`vm.skin`, `vm.constraints`, `vm.routine`). Do not send purchases.
- Re-run after a KG write: in the `configureCdp(..., onWrite)` callback, after `panel.update()`, call the fit fetch again. Show `loading` while it runs.
- Keep the async request in its own module function, `fetchFit(proxyUrl, body) → Promise<answer|null>`, with a 45 s AbortController timeout.
- All strings go in `am-i-for-you-copy.js` (`fit.title`, `fit.loading`, `fit.error`, `fit.retry`, `fit.try`, `fit.sources`, verdict labels: "Good fit" / "Use with caution" / "Not for you" / "Need more info").
- Emit `fit_shown` with `{verdict}` when the answer renders. `toAgentEvent` must keep ignoring it (it is not a KG write).
Gate (Chrome):
1. Open the panel. The card shows `loading`, then the answer, without blocking tabs.
2. Type "my skin is normal and not sensitive anymore" in Something changed. After the write, the card reloads and the answer changes.
3. Stop the proxy and reload. The card shows `error` and the rest of the panel works with the seed data.

### 6. Tests (`theme/test/am-i-for-you.test.mjs`)
- A pure renderer `renderFit(state, answer)` with tests for each state, including missing `if_you_try` and an unknown verdict.
- `toAgentEvent({type:"fit_shown"})` returns null.
Gate: `npm run test:aify` passes. `node --check` passes on changed files. `shopify theme check` shows no new errors.

### 7. Wrap up
Add an entry to `docs/progress.md`: gate evidence, latency (fit agent ms), and open risks. Commit in small commits: data, agent, proxy, UI, tests.

## Constraints
- Do not change `CDP_AGENT`. Writes and reads stay separate agents.
- Do not show ingredient facts as medical claims. Show the source label for each guidance-based reason (the rule in `guidance.json` `_doc`).
- Keep the 10 s loading bar and the existing tabs as they are.
- No new dependencies.

## Known risks
- Latency: the writer agent takes 12–16 s. Expect the same here. Starting at init hides most of it. If it is over 20 s, put `product_facts` and the profile in the message and drop those tool calls.
- `models: orchestration: auto` may pick a slow model. If it is too slow, try a fixed model that `SHOW` lists for this account. `claude-4-sonnet` is in legacy state here.
- AHA → `ING:glycolic` is an approximation. Say "AHA (e.g. glycolic acid)" in the answer, not "glycolic acid".
- The salicylic / pregnancy weight 0.7 blocks 198 Sephora products (see progress.md). It is not used here, but do not copy that weight.
