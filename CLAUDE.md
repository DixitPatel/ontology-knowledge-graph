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

## Status
- T1–T17 done. All 6 phase gates pass (see `docs/progress.md` for evidence per ticket).
- To demo: `cd theme && shopify theme dev --store $STORE` (background) + `cd backend && npm start`, then `node scripts/demo.mjs` or follow `docs/demo-script.md` by hand.
