# oneself-intent

Shopify MVP that captures skincare shopper intent and stores it as zero-party data.
Hackathon build. Speed matters. Follow PLAN.md.

## Operating mode: run end to end
- Work through PLAN.md tickets in order (T3 → T17). Do not stop for approval.
- Use the task list. One ticket at a time.
- At each gate: verify it yourself (tests, curl, Playwright). Log result in `docs/progress.md`. Commit. Continue.
- Stop only if: a gate fails 3 times, or a step needs a human browser login (e.g. `shopify store auth`). Then say exactly what to click and wait.
- Commit format: `T<n>: <summary>`. Never `git push`.
- Run `npm test` in /backend before each commit that touches /backend.

## Hard rules
- No Shopify admin UI steps. Change store data only with `shopify store execute --store $STORE --allow-mutations`.
- Behavior capture is theme JS → backend. No admin-installed pixel.
- Never invent product facts. Unknown stays `unknown` (example: `aha_strength:unknown`).
- Work only inside this folder.

## Environment
- STORE=oneself-kczbrdsl.myshopify.com
- Theme: Dawn in /theme. Preview: `cd theme && shopify theme dev --store $STORE` → http://127.0.0.1:9292
  Run it in the background; do not block on it.
- Backend: Node 20, Express, SQLite, port 8787.
- Playwright for smoke/e2e (`npx playwright` with installed Chromium).

## Status
- T1 done: dev store.
- T2 done: Dawn pulled, theme dev runs.
- T3 next: `shopify store auth` (human approves once in browser), then scripts/seed.mjs.
