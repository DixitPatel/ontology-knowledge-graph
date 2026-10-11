/* "Am I for you?" panel -- "Is this right for you?" fit card.
 * repo: src/am-i-for-you/sections/fit.js
 *
 * Shows above the tabs (every tab, not a tab of its own) -- a verdict
 * from FIT_AGENT (docs/Snowflake_fit_agent.sql) grounded in the
 * product's ontology facts, sourced guidance, and the shopper's own
 * personal KG. Fetch starts at page init (am-i-for-you.js), not on
 * panel open, and never blocks the panel itself.
 *
 * renderFit() is PURE: (state, answer) -> HTML string. No DOM, no
 * fetch -- fetchFit() and the retry wiring live in am-i-for-you.js,
 * which owns the actual <div data-cf-slot="fit"> element.
 */

import { t } from "./am-i-for-you-copy.js";

const DEFAULT_PROXY_URL = "http://127.0.0.1:8788";
const FIT_TIMEOUT_MS = 45000;

const VERDICT_KEY = {
  good_fit: "fit.verdict.good_fit",
  caution: "fit.verdict.caution",
  not_for_you: "fit.verdict.not_for_you",
  need_more_info: "fit.verdict.need_more_info",
};
const VERDICT_CLASS = {
  good_fit: "aify-fit-pill--good",
  caution: "aify-fit-pill--warn",
  not_for_you: "aify-fit-pill--warn",
};

export function renderFit(state, answer) {
  if (state === "loading") {
    return `
      <h3>${t("fit.title")}</h3>
      <p class="aify-fit-shimmer">${t("fit.loading")}</p>`;
  }
  if (state === "error") {
    return `
      <h3>${t("fit.title")}</h3>
      <p>${t("fit.error")}</p>
      <button type="button" class="aify-fit-retry">${t("fit.retry")}</button>`;
  }

  const verdict = answer?.verdict;
  const label = t(VERDICT_KEY[verdict] || VERDICT_KEY.need_more_info);
  const pillClass = `aify-fit-pill ${VERDICT_CLASS[verdict] || ""}`;
  const reasons = answer?.reasons ?? [];
  const ifYouTry = answer?.if_you_try ?? [];
  const sources = answer?.sources ?? [];

  return `
    <h3>${t("fit.title")}</h3>
    <span class="${pillClass}">${label}</span>
    ${answer?.headline ? `<p class="aify-fit-headline">${answer.headline}</p>` : ""}
    ${reasons.length ? `<ul class="aify-fit-reasons">${reasons.map((r) => `<li>${r.text}</li>`).join("")}</ul>` : ""}
    ${ifYouTry.length ? `<div class="aify-fit-try"><strong>${t("fit.try")}</strong><ul>${ifYouTry.map((x) => `<li>${x}</li>`).join("")}</ul></div>` : ""}
    ${sources.length ? `<p class="aify-fit-sources">${t("fit.sources")}: ${sources.join(" · ")}</p>` : ""}`;
}

// answer|null on success (including "no parsable reply"), never throws.
export async function fetchFit(proxyUrl, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FIT_TIMEOUT_MS);
  try {
    const res = await fetch(`${proxyUrl || DEFAULT_PROXY_URL}/fit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.answer ?? null;
  } catch (err) {
    console.warn("[aify:fit] fetch failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
