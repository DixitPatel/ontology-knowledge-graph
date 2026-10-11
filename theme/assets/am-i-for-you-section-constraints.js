/* "Am I for you?" panel -- budget section.
 * repo: src/am-i-for-you/sections/constraints.js
 *
 * "Avoid" and "Past reactions" used to live here too; both now render in
 * the Skin & Routine tab (am-i-for-you-section-skin.js) -- they read as
 * part of the skin profile, not a budget constraint. This is just Budget
 * now.
 */

import { t } from "./am-i-for-you-copy.js";

export const ConstraintsSection = {
  id: "constraints",
  tabKey: "tab.constraints",
  render: (vm) => `
    <div class="aify-card" data-cf-slot="constraints.budget">
      <h3>${t("con.budget")}</h3>
      <div class="aify-kv">
        <div class="aify-mini"><div class="aify-k">Tier</div><div class="aify-v">${vm.constraints.budget.tier}</div></div>
        <div class="aify-mini"><div class="aify-k">Max per product</div><div class="aify-v">$${vm.constraints.budget.max_per_product}</div></div>
      </div>
    </div>`,
};
