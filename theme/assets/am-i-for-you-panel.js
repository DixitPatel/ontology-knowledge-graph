/* "Am I for you?" panel -- shell.
 * repo: src/am-i-for-you/panel.js
 *
 * Open/close, tabs, lazy render, focus, Esc, scrim. Knows nothing about
 * what a section renders -- sections are {id, tabKey, render(vm), mount?}.
 */

import { t } from "./am-i-for-you-copy.js";
import { emit } from "./am-i-for-you-events.js";

export function createPanel({ sections, vm, initialTab = sections[0]?.id }) {
  const root = document.createElement("div");
  root.innerHTML = `
    <button type="button" class="aify-scrim" tabindex="-1" aria-hidden="true"></button>
    <aside class="aify-panel" role="dialog" aria-modal="true" aria-labelledby="aify-title" data-cf-slot="panel">
      <header class="aify-head">
        <div class="aify-avatar" aria-hidden="true">${vm.name[0]}</div>
        <div><h2 id="aify-title">${t("head.greeting", vm.name)}</h2><p>${t("head.sub")}</p></div>
        <button class="aify-close" aria-label="Close">×</button>
      </header>
      <nav class="aify-tabs" role="tablist">${sections
        .map((s) => `<button class="aify-tab" role="tab" data-tab="${s.id}">${t(s.tabKey)}</button>`)
        .join("")}</nav>
      <div class="aify-body">${sections
        .map((s) => `<section class="aify-section" role="tabpanel" data-sec="${s.id}"></section>`)
        .join("")}</div>
    </aside>`;
  document.body.appendChild(root);

  const rendered = new Set();

  const select = (id) => {
    root.querySelectorAll(".aify-tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === id));
    root.querySelectorAll(".aify-section").forEach((s) => s.classList.toggle("active", s.dataset.sec === id));
    const el = root.querySelector(`[data-sec="${id}"]`);
    const sec = sections.find((s) => s.id === id);
    if (!sec) return;
    if (!rendered.has(id)) {
      el.innerHTML = sec.render(vm);
      sec.mount?.(el, vm);
      rendered.add(id);
    }
    emit("tab_viewed", { tab: id });
  };

  root.querySelectorAll(".aify-tab").forEach((b) => (b.onclick = () => select(b.dataset.tab)));

  let lastFocus = null;
  const open = () => {
    lastFocus = document.activeElement;
    document.body.classList.add("aify-open");
    if (initialTab) select(initialTab);
    root.querySelector(".aify-close").focus();
    emit("panel_opened");
  };
  const close = () => {
    document.body.classList.remove("aify-open");
    lastFocus?.focus();
    emit("panel_closed");
  };

  root.querySelector(".aify-close").onclick = close;
  root.querySelector(".aify-scrim").onclick = close;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("aify-open")) close();
  });

  return { open, close };
}
