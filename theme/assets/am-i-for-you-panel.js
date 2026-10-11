/* "Am I for you?" panel -- shell.
 * repo: src/am-i-for-you/panel.js
 *
 * Open/close, tabs, lazy render, focus, Esc, scrim. Knows nothing about
 * what a section renders -- sections are
 * {id, tabKey, render(vm), mount?, minWidth?(vm)}. minWidth lets a
 * section (the routine DAG, so far) ask for a wider panel than the
 * default --panel-w; omitting it keeps the default width.
 */

import { t } from "./am-i-for-you-copy.js";
import { emit } from "./am-i-for-you-events.js";

// How long the loading moment shows before the tabs/content reveal. Kept
// as one constant so the JS reveal timing and the CSS fill animation
// (set as an inline style below, not a CSS file constant) can't drift.
const LOADING_MS = 5000;
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      <div class="aify-loading" aria-live="polite">
        <div class="aify-loading-bar" aria-hidden="true"><span style="animation-duration:${LOADING_MS}ms"></span></div>
        <p>${t("loading.message")}</p>
      </div>
      <nav class="aify-tabs" role="tablist" hidden>${sections
        .map((s) => `<button class="aify-tab" role="tab" data-tab="${s.id}">${t(s.tabKey)}</button>`)
        .join("")}</nav>
      <div class="aify-body" hidden>${sections
        .map((s) => `<section class="aify-section" role="tabpanel" data-sec="${s.id}"></section>`)
        .join("")}</div>
    </aside>`;
  document.body.appendChild(root);

  const panelEl = root.querySelector(".aify-panel");
  const loadingEl = root.querySelector(".aify-loading");
  const tabsEl = root.querySelector(".aify-tabs");
  const bodyEl = root.querySelector(".aify-body");
  const rendered = new Set();

  const select = (id) => {
    root.querySelectorAll(".aify-tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === id));
    root.querySelectorAll(".aify-section").forEach((s) => s.classList.toggle("active", s.dataset.sec === id));
    const el = root.querySelector(`[data-sec="${id}"]`);
    const sec = sections.find((s) => s.id === id);
    if (!sec) return;
    panelEl.style.width = sec.minWidth ? `min(max(var(--panel-w), ${sec.minWidth(vm)}px), 96vw)` : "";
    if (!rendered.has(id)) {
      el.innerHTML = sec.render(vm);
      sec.mount?.(el, vm);
      rendered.add(id);
    }
    emit("tab_viewed", { tab: id });
  };

  root.querySelectorAll(".aify-tab").forEach((b) => (b.onclick = () => select(b.dataset.tab)));

  let lastFocus = null;
  let loadingTimer = null;

  const reveal = () => {
    loadingEl.hidden = true;
    tabsEl.hidden = false;
    bodyEl.hidden = false;
    if (initialTab) select(initialTab);
  };

  const open = () => {
    lastFocus = document.activeElement;
    document.body.classList.add("aify-open");

    // Reset to the loading state every time the panel opens -- it's
    // framed as fetching this shopper's context fresh, not a one-time
    // splash. Re-triggers the bar's fill animation by replacing its
    // <span> (toggling a class wouldn't restart a running animation).
    clearTimeout(loadingTimer);
    loadingEl.hidden = false;
    tabsEl.hidden = true;
    bodyEl.hidden = true;
    const bar = loadingEl.querySelector(".aify-loading-bar");
    bar.innerHTML = `<span style="animation-duration:${LOADING_MS}ms"></span>`;

    root.querySelector(".aify-close").focus();
    emit("panel_opened");

    if (prefersReducedMotion()) {
      reveal();
    } else {
      loadingTimer = setTimeout(reveal, LOADING_MS);
    }
  };
  const close = () => {
    clearTimeout(loadingTimer);
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
