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
      <form class="aify-change" data-cf-slot="skin.change" hidden>
        <input type="text" name="text" placeholder="${t("skin.change_placeholder")}" aria-label="${t("skin.change_placeholder")}" />
        <button type="submit">${t("skin.save")}</button>
        <div class="aify-change-status" aria-live="polite"></div>
      </form>
    </div>
    <div class="aify-card" style="animation-delay:60ms" data-cf-slot="skin.concerns">
      <h3>${t("skin.concerns")}</h3>
      <div class="aify-chips">${vm.skin.concerns
        .map((c) => `<span class="aify-chip ${c.rank === "primary" ? "aify-primary" : ""}">${c.label}<small>${c.severity}</small></span>`)
        .join("")}</div>
      <h3 style="margin-top:14px">${t("skin.goals")}</h3>
      <div class="aify-chips">${vm.skin.goals.map((g) => `<span class="aify-chip">${g}</span>`).join("")}</div>
    </div>
    <div class="aify-card" style="animation-delay:120ms" data-cf-slot="skin.avoid">
      <h3>${t("con.avoid")}</h3>
      <div class="aify-chips">${vm.constraints.avoid
        .map((a) => `<span class="aify-chip aify-avoid">${a.label}<small>${a.reason}</small></span>`)
        .join("")}</div>
    </div>
    <div class="aify-card" style="animation-delay:180ms" data-cf-slot="skin.reactions">
      <h3>${t("con.reactions")}</h3>
      ${vm.constraints.reactions
        .map(
          (r) => `
        <div class="aify-row"><div>${r.label} — ${r.effect}<div class="aify-sub">${r.product} · ${r.date}</div></div><span class="aify-tag aify-ret">reaction</span></div>`
        )
        .join("")}
    </div>`,
  mount: (el) => {
    el.querySelectorAll("[data-ans]").forEach((b) => {
      b.onclick = () => {
        el.querySelectorAll("[data-ans]").forEach((x) => x.classList.toggle("aify-on", x === b));
        emit("profile_confirmation", { field: "skin", answer: b.dataset.ans });
        const form = el.querySelector(".aify-change");
        form.hidden = b.dataset.ans !== "changed";
        if (!form.hidden) form.querySelector("input").focus();
        if (b.dataset.ans === "yes") el.querySelector(".aify-change-status").textContent = "";
      };
    });
    const form = el.querySelector(".aify-change");
    const status = form.querySelector(".aify-change-status");
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      status.textContent = t("skin.saving");
      form.querySelector("button").disabled = true;
      emit("profile_change_text", { text });
    };
    // Error/no-op reply: the panel is not redrawn, so say so here.
    const onKg = (e) => {
      if (!el.isConnected) return window.removeEventListener("aify:kg", onKg);
      const { result, error } = e.detail;
      if (error) status.textContent = t("skin.save_failed");
      else if (result && !result.writes?.length) status.textContent = result.skipped?.[0] || t("skin.no_change");
      form.querySelector("button").disabled = false;
    };
    window.addEventListener("aify:kg", onKg);
  },
};
