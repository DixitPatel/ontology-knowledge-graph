/* "Am I for you?" panel -- entry.
 * repo: src/am-i-for-you/index.js
 *
 * Builds the view model, creates the panel, mounts the trigger button
 * next to Add to bag. Loaded as a module on the product template only
 * (theme/sections/main-product.liquid), so window.ONESELF_PRODUCT_HANDLE
 * is already set by theme.liquid by the time this runs.
 */

import { getLiveContext, buildViewModel } from "./am-i-for-you-view-model.js";
import { SECTIONS } from "./am-i-for-you-sections.js";
import { createPanel } from "./am-i-for-you-panel.js";
import { configure, emit } from "./am-i-for-you-events.js";
import { configureCdp } from "./am-i-for-you-cdp.js";
import { renderFit, fetchFit } from "./am-i-for-you-section-fit.js";
import { t } from "./am-i-for-you-copy.js";

// Single seed shopper for the hackathon MVP -- see docs/progress.md for
// why (no demo-controls bar/shopper-switcher exists in this repo).
const CUSTOMER_ID = "customer_003";

async function init() {
  const mount = document.querySelector('[data-cf-slot="trigger-mount"]');
  if (!mount) return;

  const pageHandle = window.ONESELF_PRODUCT_HANDLE;
  const proxyUrl = window.ONESELF_CDP_PROXY_URL;
  configure(CUSTOMER_ID, pageHandle);
  let panel = null;

  // FIT_AGENT's "Is this right for you?" card. Starts at init, not on
  // panel open, and never awaited -- the trigger button/panel are ready
  // as soon as the profile loads, independent of how long this takes.
  const runFit = async (vm) => {
    if (!panel || !pageHandle) return;
    panel.fitEl.innerHTML = renderFit("loading", null);
    const answer = await fetchFit(proxyUrl, {
      shopper_id: `SHP:${CUSTOMER_ID}`,
      product_handle: pageHandle,
      panel_context: { skin: vm.skin, constraints: vm.constraints, routine: vm.routine },
    });
    panel.fitEl.innerHTML = renderFit(answer ? "ready" : "error", answer);
    if (answer) {
      emit("fit_shown", { verdict: answer.verdict });
    } else {
      panel.fitEl.querySelector(".aify-fit-retry").onclick = () => runFit(vm);
    }
  };

  // After the agent writes to the KG, re-read /profile, redraw, and
  // re-check the fit answer against the shopper's updated graph.
  configureCdp(CUSTOMER_ID, pageHandle, proxyUrl, async () => {
    const next = await getLiveContext(CUSTOMER_ID, pageHandle, proxyUrl);
    const nextVm = buildViewModel(next.profile, next.ext, next.catalog, next.page);
    nextVm.source = next.source;
    panel?.update(nextVm);
    runFit(nextVm);
  });

  // Skin & Routine read from the Snowflake KG; falls back to the seed.
  const ctx = await getLiveContext(CUSTOMER_ID, pageHandle, proxyUrl);
  const vm = buildViewModel(ctx.profile, ctx.ext, ctx.catalog, ctx.page);
  vm.source = ctx.source;
  panel = createPanel({ sections: SECTIONS, vm });
  runFit(vm);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "aify-trigger";
  btn.dataset.cfSlot = "trigger";
  btn.innerHTML = `<span class="dot" aria-hidden="true"></span>${t("trigger.label")}`;
  btn.onclick = panel.open;
  mount.appendChild(btn);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
