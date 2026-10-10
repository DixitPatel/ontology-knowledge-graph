# Intent-Capture Skincare Store — MVP Build Plan (for Claude Code)

## How Claude Code uses this plan

- Put this file in the repo root. Reference it from `CLAUDE.md`: "Follow PLAN.md. Work one ticket at a time."
- Start each phase in plan mode. Show the ticket plan, then implement.
- Track tickets in the task list. Mark a ticket done only when its acceptance check passes.
- Run end to end. Do not stop for approval. At each gate, verify it yourself (tests, curl, Playwright), log the result in `docs/progress.md`, commit, and continue.
- Stop only if a gate fails 3 times or a step truly needs the human (browser OAuth login).
- Run `npm test` in `/backend` before each commit.
- No Shopify admin UI steps. Store data changes go through `shopify store execute`. Behavior capture lives in the theme, not in an admin-installed pixel.

## 0. Goal

Build a minimal Shopify storefront based on the One Self skincare catalog (feeloneself.com).
The store must:

1. Show a real shopping flow (home → shop → product → cart → checkout).
2. Record shopper behavior on each page.
3. Infer the shopper's likely open question.
4. Ask one short in-page question ("Is this right for you?").
5. Store the answer as zero-party data.

Do not build anything outside this scope.

## 1. Stack

| Layer | Choice | Reason |
|---|---|---|
| Store | Shopify Partner development store (free) | Real Shopify checkout, admin, and events |
| Theme | Dawn (Online Store 2.0), pulled with Shopify CLI | Default theme, section/block based, easy to extend |
| Theme dev | `shopify theme dev --store <store>` | Hot reload against the dev store |
| Store data | `shopify store auth` + `shopify store execute --allow-mutations` | Seed products and collections via Admin GraphQL, no admin UI |
| Behavior capture | Theme JS `assets/oneself-events.js` → `POST /events` (sendBeacon) | All events from storefront; no admin pixel install |
| Intent UI | New Dawn section `intent-prompt.liquid` + `intent-prompt.js` | In-page card on product page |
| Zero-party storage | Cart attributes via `/cart/update.js` + backend DB | Answers reach the order in admin with no app install |
| Backend | Node 20 + Express + SQLite (one service) | Event ingest, hypothesis scoring, question pick |
| Ontology | `ontology/skincare.json` (static) | Maps confirmed need → relevant verified attributes → products |
| Backend URL | `http://127.0.0.1:8787` (local preview); `cloudflared` only for the shared preview link | Theme JS reads it from a theme setting |

Not in scope: custom Shopify app, OAuth, Hydrogen, customer accounts, metafield writes, payments setup, ML models.

## 2. Catalog seed

Create with `seed/products.csv` (Shopify product CSV import).

| Handle | Title | Type | Key attributes (product metafields or tags) |
|---|---|---|---|
| cloud-whip-moisturiser | Cloud Whip Barrier Restore Moisturiser | Moisturiser | barrier repair; all skin types; 150 ml |
| smooth-operator-aha-serum | Smooth Operator AHA Serum | Serum | AHA exfoliant; texture, dullness; patch test advised |
| glow-barrier-duo | Glow Barrier Duo | Bundle | serum + moisturiser; 2-step routine |

Use tags for attributes (fast, no metafield setup): `skin:dry`, `skin:oily`, `skin:sensitive`, `concern:texture`, `concern:dullness`, `concern:barrier`, `active:aha`, `step:treat`, `step:moisturise`.

Note: the live site has inconsistent AHA % (3% vs 10%). Put one verified value in seed data. Mark unknown values as `unknown`, never guess.

## 3. Pages (minimal)

| Page | Template | What it measures |
|---|---|---|
| Home | `index.json` | Entry, routine-section views, CTA clicks |
| Shop | `collection.json` | Product cards viewed, filter use, product compare-hopping |
| Product | `product.json` + `intent-prompt` section | Section opens, dwell, scroll depth, variant switches, add/remove cart |
| Cart | `cart.json` | Add/remove, bundle vs single, abandon |
| Checkout | Shopify-hosted | `checkout_started` (button click only) |

Product page sections must be collapsible so opens can be counted:
"What I Do", "What's Inside", "How to Use Me", "Am I For You?", "What to Expect", "Reviews".

## 4. Behavior signals

Standard (from theme JS, by template + cart fetch hooks): `page_viewed`, `collection_viewed`, `product_viewed`, `product_added_to_cart`, `product_removed_from_cart`, `cart_viewed`, `checkout_started` (checkout button click). Checkout-internal events are out of scope.

Custom (from theme JS, prefix `oneself:`):

| Event | Trigger | Payload |
|---|---|---|
| section_opened | collapsible opened | product_handle, section_id |
| section_dwell | section open > 5 s | product_handle, section_id, ms |
| scroll_depth | 25/50/75/100% | product_handle, pct |
| review_filter | review search/filter used | product_handle, term |
| product_hop | 2nd+ product viewed in 2 min | from, to |
| intent_prompt_shown | prompt rendered | hypothesis_set, question_id |
| intent_answered | option clicked | question_id, answer_id |
| intent_dismissed | prompt closed | question_id |

Session key: `oneself_sid` (UUID in localStorage, fallback cookie). Send to backend `POST /events` with `navigator.sendBeacon`.

## 5. Hypotheses (skincare)

| Hypothesis | Signals | Question | Options |
|---|---|---|---|
| skin_type_fit | opens "Am I For You?", reviews filtered by skin type | What is your skin like? | Dry · Oily · Combination · Sensitive |
| irritation_risk | opens "What's Inside" + dwell on AHA, "Good to Know" | Has your skin reacted to acids before? | Yes · No · Never used acids · Not sure |
| where_to_start | home routine views, hops serum ↔ moisturiser ↔ duo | What are you working on? | Starting a routine · Adding one step · Replacing a product |
| results_timeline | opens "What to Expect", reviews mention "weeks" | When do you want to see change? | 1–2 weeks · A month · No rush |
| value_check | duo ↔ single hops, add/remove cart | What would help you decide? | Bundle savings · Which one first · Size/how long it lasts |
| general_browsing | low signal | (no question) | — |

Scoring v1: weighted rule counts per hypothesis, normalized to sum 1.0.
Ask only when top hypothesis ≥ 0.45 and lead over second ≥ 0.15.
Ask at most one question per product page per session. Never re-ask after dismiss.

## 6. Ontology (v1)

`ontology/skincare.json`, edges only:

```
SkinTypeFit       REQUIRES   suitable_skin_types
IrritationRisk    REQUIRES   active_ingredients, active_strength, patch_test_note
WhereToStart      REQUIRES   routine_step
ResultsTimeline   REQUIRES   expected_timeline
ValueCheck        REQUIRES   price, size_ml, bundle_contents
Sensitive         AVOID_IF   active:aha AND active_strength=unknown
```

Rule: after an answer, return only attributes with verified values. If a required value is `unknown`, show "We don't have verified information to confirm this."

## 7. Backend API

| Method | Path | Purpose |
|---|---|---|
| POST | /events | Store event; update session scores |
| GET | /intent?client_id=&product= | Return `{ ask: bool, question, options, scores }` |
| POST | /answers | Store declared answer; return ontology result |
| GET | /sessions/:client_id | Debug: timeline + scores (demo screen) |

Tables: `events`, `session_scores`, `answers`.
CORS: allow `http://127.0.0.1:9292` and the store domain.

## 8. Repo layout

```
/theme                # Dawn, pulled via `shopify theme init` or `theme pull`
  sections/intent-prompt.liquid
  assets/intent-prompt.js
  assets/oneself-events.js
/scripts/seed.mjs       # Admin GraphQL via `shopify store execute`
/scripts/graphql/       # .graphql mutation files
/backend
  src/server.js
  src/scoring.js
  src/ontology.js
  test/
/ontology/skincare.json
/seed/products.csv
/docs/demo-script.md
```

## 9. SDLC — phases and gates

Each phase ends with a gate. Claude Code verifies the gate itself and continues.
Each ticket: branch → code → tests → self-review → commit.

### Phase 1 — Setup
- T1. DONE — dev store `oneself-kczbrdsl.myshopify.com`.
- T2. DONE — Dawn in `/theme`, `theme dev` runs.
- T3. `shopify store auth --store oneself-kczbrdsl.myshopify.com --scopes read_products,write_products,read_publications,write_publications` (one browser approval by the human). Then `scripts/seed.mjs` reads `seed/products.csv` and runs `productSet` (price, compare-at, tags), `collectionCreate` ("Shop All", smart rule price > 0), and `publishablePublish` to the Online Store publication. Script is idempotent (look up by handle first).
- **Gate:** `shopify store execute` query returns 3 products, published. `curl -s http://127.0.0.1:9292/products/<handle>.json` returns each product.

### Phase 2 — Pages
- T4. Home: hero, 2-step routine section, product grid.
- T5. Product template: collapsible sections listed in §3, tags rendered as "Am I For You?".
- T6. Cart shows bundle vs single clearly.
- **Gate:** Playwright script `scripts/smoke.mjs` walks home → shop → product → add to cart → cart with no console errors.

### Phase 3 — Behavior capture
- T7. `oneself-events.js`: publish custom events in §4.
- T8. Standard events in `oneself-events.js` (template detection + wrap `fetch` for `/cart/add`, `/cart/change`).
- T9. Backend `/events` + SQLite.
- **Gate:** Playwright session produces ordered events in `/sessions/:id`.

### Phase 4 — Inference + prompt
- T10. `scoring.js` with rules in §5. Unit tests per hypothesis.
- T11. `GET /intent`.
- T12. `intent-prompt` section: poll `/intent` on signal change (debounce 2 s), render card, send answer.
- T13. Write answer to cart attributes (`/cart/update.js`, key `oneself_intent_<question_id>`).
- **Gate:** Playwright "AHA worry" session → prompt shows irritation question → answer appears on cart and in DB.

### Phase 5 — Ontology response
- T14. `ontology.js` + `skincare.json`.
- T15. After answer, card shows verified attributes or the "not verified" message.
- **Gate:** "Sensitive" answer + unknown AHA strength → "not verified" message, no recommendation.

### Phase 6 — Demo hardening
- T16. `/sessions/:id` debug view (events + live scores).
- T17. `docs/demo-script.md`: 2 scripted shopper paths.
- **Gate:** Both demo paths run twice via Playwright with no manual DB edits.

## 10. Definition of Done (every ticket)

- Acceptance check in the ticket passes.
- Unit tests pass (`npm test` in /backend).
- No secrets in repo. Store URL and backend URL in `.env`.
- No console errors on the touched page.
- Commit message names the ticket (e.g. `T10: rule-based scoring`).

## 11. Demo acceptance paths

1. **AHA worry:** Shop → serum → open "What's Inside" (dwell) → open "Good to Know" → prompt: "Has your skin reacted to acids before?" → "Yes" → card shows verified ingredient facts + patch-test note → answer on cart.
2. **Where to start:** Home routine → serum → moisturiser → duo → prompt: "What are you working on?" → "Starting a routine" → card points to Glow Barrier Duo with step order.
