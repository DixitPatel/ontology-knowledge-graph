/* "Am I for you?" panel -- budget section.
 * repo: src/am-i-for-you/sections/constraints.js
 *
 * "Avoid" used to live here too; it now renders in the Skin & Routine
 * tab, right below Concerns (am-i-for-you-section-skin.js) -- avoid
 * reads as part of the skin profile, not a budget constraint.
 */

import { t } from "./am-i-for-you-copy.js";

export const ConstraintsSection = {
  id: "constraints",
  tabKey: "tab.constraints",
  render: (vm) => `
    <div class="aify-card" data-cf-slot="constraints.reactions">
      <h3>${t("con.reactions")}</h3>
      ${vm.constraints.reactions
        .map(
          (r) => `
        <div class="aify-row"><div>${r.label} — ${r.effect}<div class="aify-sub">${r.product} · ${r.date}</div></div><span class="aify-tag aify-ret">reaction</span></div>`
        )
        .join("")}
    </div>
    <div class="aify-card" style="animation-delay:60ms" data-cf-slot="constraints.budget">
      <h3>${t("con.budget")}</h3>
      <div class="aify-kv">
        <div class="aify-mini"><div class="aify-k">Tier</div><div class="aify-v">${vm.constraints.budget.tier}</div></div>
        <div class="aify-mini"><div class="aify-k">Max per product</div><div class="aify-v">$${vm.constraints.budget.max_per_product}</div></div>
      </div>
    </div>`,
};
