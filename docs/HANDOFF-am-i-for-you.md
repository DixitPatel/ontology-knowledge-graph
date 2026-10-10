# Handoff: "Am I for you?" personalization panel

Hackathon MVP. Coframe Living Internet Build Day, 2026-10-10.
Target page: `http://127.0.0.1:9292/products/glow-barrier-duo` (and every other `/products/*` page).

Reference prototype: `docs/am-i-for-you-prototype.html`. Open it in a browser. It is the UX spec. Match its look and behavior. Its `/* repo: ... */` comments give the target file for each block.

## 1. Goal

Add an **"Am I for you?"** button next to **Add to bag**. A click opens a right-side panel. The panel greets the logged-in shopper and shows their CDP context in four tabs:

1. **Skin** — type, sensitivity, Fitzpatrick, age/climate, concerns, goals.
2. **Avoid & budget** — avoided ingredients, past reactions, budget.
3. **Purchases** — recent orders, returns flagged.
4. **Routine** — AM/PM routine as a left-to-right DAG. The current product shows as a dashed "This product?" node at its candidate slot.

UX is the priority. The panel must feel fluid.

Out of scope now: decision engine, knowledge graph, LLM copy, real CDP API. Use seed data. Keep the seams so they plug in later (section 6).

## 2. Step 0 — git

1. Run `git status`.
2. If there are uncommitted changes, commit them: `chore: checkpoint before am-i-for-you panel`.
3. Create branch `feat/am-i-for-you`.
4. Make one commit per step in section 5. Do not squash.

## 3. Step 1 — fit the repo

Before you write code:

- Find the stack (port 9292 suggests Rack/Sinatra or `shopify theme dev`; confirm).
- Find how the product page renders and where **Add to bag** lives.
- Find the existing JS/CSS pipeline and the existing design tokens (the page already uses the cream/green palette).
- Find the existing demo controls bar and shopper id (`shopper: e2e1`). Add `customer_003` as a selectable seed shopper if the bar supports it.

Fit the repo conventions. If there is no front-end framework, use plain ES modules, as in the prototype. Do not add a framework for this.

## 4. Module layout

```
src/am-i-for-you/
  index.js          # entry: build view model, create panel, mount trigger
  panel.js          # shell: open/close, tabs, lazy render, focus, Esc, scrim
  viewModel.js      # PURE: (profile, ext, catalog, page) -> vm
  copy.js           # every visible string, keyed; t(key, ...args)
  events.js         # emit(type, payload) -> CustomEvent "aify:event"
  sections/
    index.js        # SECTIONS = [skin, constraints, purchases, routine]
    skin.js
    constraints.js
    purchases.js
    routine.js      # layoutRoutine() is PURE; render draws SVG
  seed/
    customer_003.profile.json   # CDP schema 1.1, exactly as given
    customer_003.ext.json       # display_name, purchases (schema 1.1 lacks these)
    catalog.json                # sku -> {name, price}
    pages.json                  # handle -> {sku, candidate_slot}
  am-i-for-you.css  # all styles, prefixed .aify-
```

Rules:

- `viewModel.js` and `layoutRoutine()` are pure. Unit test them.
- A section is `{ id, tabKey, render(vm) -> html, mount?(el, vm) }`. The panel knows nothing about section content.
- Components never hardcode text. All text goes through `copy.js`.
- Do not change the CDP 1.1 schema. Put extra fields in `*.ext.json`.
- Load seed data through one function, `getContext(customerId, pageHandle)`. Later it calls the CDP and decision engine.

## 5. Build steps (one commit each)

| # | Commit | Done when |
|---|--------|-----------|
| 1 | `feat(aify): seed data + view model` | `buildViewModel` returns the shape used by the prototype. Unit test passes. |
| 2 | `feat(aify): trigger + panel shell` | Button shows next to Add to bag on every product page. Panel slides in (≈260 ms), scrim click and Esc close it, focus returns to button. Tabs switch. Sections are empty. |
| 3 | `feat(aify): skin section` | Mini-card grid with provenance line (`source · date · confidence`). Concern chips, primary highlighted. "Is this still right?" Yes / Something changed emits `profile_confirmation`. |
| 4 | `feat(aify): avoid & budget section` | Avoid chips with reason. Reactions rows. Budget mini-cards. |
| 5 | `feat(aify): purchases section` | Rows with name, date, price × qty, status tag. Returned items use the warn tag. |
| 6 | `feat(aify): routine DAG` | Two lanes, AM and PM. Nodes show product type + key ingredient (or product name). Arrows draw in. Ghost node is dashed and sits at `candidate_slot`. Click or Enter on a node shows a detail line and emits `routine_node_selected`. SVG width grows with the longest lane (no clipping). |
| 7 | `feat(aify): events + coframe slots` | Every event in section 6.2 fires. Every slot in 6.3 exists in the DOM. |
| 8 | `chore(aify): polish + a11y` | Checklist in section 7 passes. |

After each step, open `/products/glow-barrier-duo`, click the button, and check the tab you built. Compare it with the prototype.

## 6. Contracts for later integration

### 6.1 Input

```js
getContext(customerId, pageHandle) -> {
  profile,   // CDP schema 1.1
  ext,       // { display_name, purchases[] }
  catalog,   // { [sku]: { name, price } }
  page       // { handle, sku, candidate_slot: { lane: "am"|"pm", before_step } | null }
}
```

Today: reads `seed/*.json`. Later: CDP for `profile`/`ext`, decision engine for `page.candidate_slot` and section order.

### 6.2 Output — events

All events dispatch on `window` as `CustomEvent("aify:event", { detail })`.

`detail` base: `{ type, customer_id, page, ts }`.

| type | extra fields | Later use |
|------|--------------|-----------|
| `panel_opened` | — | Coframe goal; engagement |
| `panel_closed` | — | dwell time |
| `tab_viewed` | `tab` | which context matters |
| `profile_confirmation` | `field`, `answer` | zero-party write to CDP |
| `routine_node_selected` | `node` (sku or `candidate`), `lane` | intent signal |

Keep one listener in `events.js` that logs to console. Later it forwards to the CDP and Coframe.

### 6.3 Coframe hooks

Coframe changes copy, order, and visibility. Give it stable handles:

- **Copy keys** in `copy.js` (`trigger.label`, `head.greeting`, `tab.*`, `skin.*`, `con.*`, `pur.*`, `rt.*`).
- **Slots**: `data-cf-slot` on `trigger`, `panel`, `skin.profile`, `skin.confirm`, `skin.concerns`, `constraints.avoid`, `constraints.reactions`, `constraints.budget`, `purchases.list`, `routine.dag`, `routine.node.step`, `routine.node.ghost`.
- **Section order**: the `SECTIONS` array and `initialTab`. Accept an override from `getContext` (e.g. `page.sections`, `page.initialTab`).

Do not rename a key or slot after commit 7.

## 7. UX and a11y checklist

- Panel width `min(440px, 100vw)`. Full width on mobile.
- Slide-in and card fade-in are short (≈260 ms). Arrows draw in staggered.
- `prefers-reduced-motion`: no animation; content shows at once.
- Panel: `role="dialog"`, `aria-modal`, labelled by the greeting.
- Tabs: `role="tablist"` / `tab` / `tabpanel`, `aria-selected`.
- DAG nodes: `tabindex="0"`, Enter/Space selects, visible focus ring in brand green.
- Detail line under the DAG is `aria-live="polite"`.
- Sections render lazily on first view, then stay mounted.
- No console errors. No layout shift on the host page.

## 8. Do not

- Add a UI framework or a graph library.
- Call a network API.
- Change the CDP schema.
- Put product-specific logic in `panel.js`.
