# Demo script

Two scripted shopper paths through the live store. Both are automated end to
end by `scripts/demo.mjs` (Playwright) — nothing here requires editing the
database by hand; the backend's SQLite tables are populated entirely by the
storefront JS as the script clicks through the site.

Prerequisites: `shopify theme dev --store $STORE` running on
`http://127.0.0.1:9292`, and the backend running on `http://127.0.0.1:8787`
(`cd backend && npm start`).

## Path 1 — "AHA worry"

A shopper is curious about the AHA serum but worried about irritation.

1. Visit the home page. Hero + "Your 2-step routine" section are visible.
2. Click through to **Smooth Operator AHA Serum**.
3. Open the **"What's Inside"** collapsible section — this is where the AHA
   / patch-test info lives.
4. Within ~2 seconds, the intent prompt appears in the bottom-right corner:
   **"Has your skin reacted to acids before?"**
5. Answer **"Yes"**.
6. The card now shows the ontology result instead of the question. Because
   this product's AHA strength is tagged `unknown` in the seed data, the
   avoid rule fires: the card shows **"We don't have verified information to
   confirm this."** and recommends nothing — it does not pretend to know the
   product is safe for sensitive, acid-reactive skin.
7. The answer is also written to the cart as the attribute
   `oneself_intent_irritation_risk: yes`, and stored in the backend's
   `answers` table.
8. Add the serum to the cart. The cart shows it tagged **"Single product"**
   (not a bundle).

**What this demonstrates:** the store asks a real question grounded in
actual shopper behavior (opening the ingredients section), and it is honest
about what it doesn't know — no invented reassurance.

## Path 2 — "Which one should I get?"

A shopper is comparing the single serum against the bundle before buying.

1. Visit **Smooth Operator AHA Serum**, then **Cloud Whip Barrier Restore
   Moisturiser** — hopping between products within a couple of minutes is
   itself a signal (`oneself:product_hop`).
2. Add the moisturiser to the cart a couple of times while weighing it
   against the bundle — cart churn is a `value_check` signal.
3. Visit **Glow Barrier Duo**. The intent prompt appears:
   **"What would help you decide?"** (the `value_check` hypothesis, driven
   by the duo↔single hopping).
4. Answer **"Bundle savings"**.
5. The card shows the duo's real, verified attributes: price (`$18.99`) and
   bundle contents (serum + moisturiser, with their sizes). `size_ml` for
   the bundle itself is honestly left out as not verified — a bundle has no
   single size.
6. Add the duo to the cart. The cart shows it tagged
   **"Bundle · 2-step routine"**.

**What this demonstrates:** real comparison-shopping behavior across
products drives a different hypothesis and question than Path 1, and the
answer surfaces genuinely verified product facts rather than marketing copy.

## Running it

```
node scripts/demo.mjs
```

Runs both paths, end to end, in a fresh browser context each time (so each
run gets its own session id — no manual cleanup needed between runs). Exits
non-zero on any assertion failure.
