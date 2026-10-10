/* "Am I for you?" panel -- skin section.
 * repo: src/am-i-for-you/sections/skin.js
 */

import { t } from "./am-i-for-you-copy.js";
import { emit } from "./am-i-for-you-events.js";

export const SkinSection = {
  id: "skin",
  tabKey: "tab.skin",
  render: (vm) => `
    <div class="aify-card" data-cf-slot="skin.profile">
      <h3>${t("skin.title")}</h3>
      <div class="aify-kv">${vm.skin.fields
        .map(
          (f) => `
        <div class="aify-mini"><div class="aify-k">${f.k}</div><div class="aify-v">${f.v}</div>${
            f.prov ? `<div class="aify-prov">${f.prov}</div>` : ""
          }</div>`
        )
        .join("")}
      </div>
      <div class="aify-confirm" data-cf-slot="skin.confirm">${t("skin.confirm")}
        <button data-ans="yes">${t("skin.yes")}</button><button data-ans="changed">${t("skin.changed")}</button>
      </div>
    </div>
    <div class="aify-card" style="animation-delay:60ms" data-cf-slot="skin.concerns">
      <h3>${t("skin.concerns")}</h3>
      <div class="aify-chips">${vm.skin.concerns
        .map((c) => `<span class="aify-chip ${c.rank === "primary" ? "aify-primary" : ""}">${c.label}<small>${c.severity}</small></span>`)
        .join("")}</div>
      <h3 style="margin-top:14px">${t("skin.goals")}</h3>
      <div class="aify-chips">${vm.skin.goals.map((g) => `<span class="aify-chip">${g}</span>`).join("")}</div>
    </div>`,
  mount: (el) => {
    el.querySelectorAll("[data-ans]").forEach((b) => {
      b.onclick = () => {
        el.querySelectorAll("[data-ans]").forEach((x) => x.classList.toggle("aify-on", x === b));
        emit("profile_confirmation", { field: "skin", answer: b.dataset.ans });
      };
    });
  },
};
