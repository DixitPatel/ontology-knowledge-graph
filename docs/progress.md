# Progress log

| Ticket | Status | Gate evidence |
|---|---|---|
| T1 | done | Dev store created |
| T2 | done | theme dev on 127.0.0.1:9292 |
| T3 | done | `shopify store auth` with scopes `read_products,write_products,read_publications,write_publications` (one browser approval). `scripts/seed.mjs` upserts `seed/products.csv` via `productSet` (identifier: handle, so re-runs are no-ops), creates/reuses a manual "Shop All" collection (the API's `CollectionCreateInput` has no `ruleSet`/smart-rule field in this version, so membership is set explicitly via `productSet`'s `collections` field instead of a price>0 smart rule — functionally equivalent since all seeded products have price > 0), and publishes each product via `publishablePublish` to the Online Store publication. Ran twice — second run reused the same collection/product IDs (idempotent). Gate: `shopify store execute` query filtered to `vendor:"One Self"` returns all 3 products, `status: ACTIVE`, `publishedOnCurrentPublication: true`, correct price/compareAtPrice/tags. `curl http://127.0.0.1:9292/products/<handle>.json` returns HTTP 200 with the right title for all 3 handles. |
