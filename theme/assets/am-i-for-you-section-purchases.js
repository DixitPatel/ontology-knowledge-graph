/* "Am I for you?" panel -- purchases section.
 * repo: src/am-i-for-you/sections/purchases.js
 */

import { t } from "./am-i-for-you-copy.js";

export const PurchasesSection = {
  id: "purchases",
  tabKey: "tab.purchases",
  render: (vm) => `
    <div class="aify-card" data-cf-slot="purchases.list">
      <h3>${t("pur.title")}</h3>
      ${vm.purchases
        .map(
          (o) => `
        <div class="aify-row"><div>${o.name}<div class="aify-sub">${o.date} · $${o.price}${o.qty > 1 ? ` × ${o.qty}` : ""}</div></div>
          <span class="aify-tag ${o.status === "returned" ? "aify-ret" : ""}">${o.status}</span></div>`
        )
        .join("")}
    </div>`,
};
