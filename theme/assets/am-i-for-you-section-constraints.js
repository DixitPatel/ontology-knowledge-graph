/* "Am I for you?" panel -- avoid & budget section.
 * repo: src/am-i-for-you/sections/constraints.js
 */

import { t } from "./am-i-for-you-copy.js";

export const ConstraintsSection = {
  id: "constraints",
  tabKey: "tab.constraints",
  render: (vm) => `
    <div class="aify-card" data-cf-slot="constraints.avoid">
      <h3>${t("con.avoid")}</h3>
      <div class="aify-chips">${vm.constraints.avoid
        .map((a) => `<span class="aify-chip aify-avoid">${a.label}<small>${a.reason}</small></span>`)
        .join("")}</div>
    </div>
    <div class="aify-card" style="animation-delay:60ms" data-cf-slot="constraints.reactions">
      <h3>${t("con.reactions")}</h3>
      ${vm.constraints.reactions
        .map(
          (r) => `
        <div class="aify-row"><div>${r.label} — ${r.effect}<div class="aify-sub">${r.product} · ${r.date}</div></div><span class="aify-tag aify-ret">reaction</span></div>`
        )
        .join("")}
    </div>
    <div class="aify-card" style="animation-delay:120ms" data-cf-slot="constraints.budget">
      <h3>${t("con.budget")}</h3>
      <div class="aify-kv">
        <div class="aify-mini"><div class="aify-k">Tier</div><div class="aify-v">${vm.constraints.budget.tier}</div></div>
        <div class="aify-mini"><div class="aify-k">Max per product</div><div class="aify-v">$${vm.constraints.budget.max_per_product}</div></div>
      </div>
    </div>`,
};
