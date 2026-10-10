/* "Am I for you?" panel -- Snowflake CDP wiring (minimal).
 *
 * Forwards every aify:event (emitted by am-i-for-you-events.js) to the
 * local Cortex Agent proxy (docs/Snowflake_agent_proxy.py) as a CLICK
 * event, then renders the agent's verdict/reasons/next_question/conflicts
 * into a small debug panel.
 *
 * Plumbing only -- does not touch the existing beauty_profile view model
 * or panel UI (see docs/Snowflake_HANDOFF.md Task 7). Shopper/product IDs
 * are best-effort (SHP:<customer_id>, PRD:<page_handle>); there is no real
 * mapping yet between this panel's catalog and the KG's PRD: node IDs, so
 * rank_products/next_question will usually come back empty/neutral for
 * products the KG doesn't know about. That's expected for this pass.
 */

const DEFAULT_PROXY_URL = "http://127.0.0.1:8788";

let shopperId = null;
let productId = null;
let proxyUrl = DEFAULT_PROXY_URL;
let debugEl = null;

function ensureDebugPanel() {
  if (debugEl) return debugEl;
  debugEl = document.createElement("div");
  debugEl.className = "aify-cdp-debug";
  debugEl.setAttribute("aria-live", "polite");
  debugEl.innerHTML = `<div class="aify-cdp-debug__head">CDP (debug)</div><div class="aify-cdp-debug__body">waiting for events&hellip;</div>`;
  debugEl.querySelector(".aify-cdp-debug__head").onclick = () => debugEl.classList.toggle("aify-cdp-debug--collapsed");
  document.body.appendChild(debugEl);
  return debugEl;
}

function renderDebug(result) {
  const el = ensureDebugPanel().querySelector(".aify-cdp-debug__body");
  if (!result) {
    el.textContent = "no response";
    return;
  }
  const { verdict, reasons = [], next_question, conflicts = [] } = result;
  el.innerHTML = `
    <div><strong>verdict:</strong> ${verdict ?? "—"}</div>
    ${reasons.length ? `<ul>${reasons.map((r) => `<li>${r}</li>`).join("")}</ul>` : ""}
    ${next_question ? `<div><strong>next question:</strong> ${next_question.text}</div>` : ""}
    ${conflicts.length ? `<div><strong>conflicts:</strong> ${conflicts.length}</div>` : ""}
  `;
}

// The agent's :run endpoint streams SSE "data: {...}" lines. The final
// verdict JSON is embedded as a string inside one of those events' content
// (a {type:"text", text:"...{\"verdict\":...}"} block), escaped by that
// event's own JSON encoding -- so it must be JSON.parsed once to unescape
// before the verdict JSON inside it can be parsed. Walk every data line's
// parsed object looking for a string value that itself parses as a
// {verdict: ...} object; the last one found wins (the agent may mention
// "verdict" earlier while narrating its plan).
function extractVerdict(sseText) {
  let found = null;
  for (const line of sseText.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let event;
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    const stack = [event];
    while (stack.length) {
      const cur = stack.pop();
      if (typeof cur === "string") {
        const trimmed = cur.trim();
        if (trimmed.startsWith("{") && trimmed.includes('"verdict"')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && parsed.verdict) found = parsed;
          } catch {
            // not the JSON we're looking for
          }
        }
      } else if (Array.isArray(cur)) {
        stack.push(...cur);
      } else if (cur && typeof cur === "object") {
        stack.push(...Object.values(cur));
      }
    }
  }
  return found;
}

async function sendEvent(type, payload) {
  if (!shopperId) return;
  try {
    const res = await fetch(`${proxyUrl}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopper_id: shopperId,
        product_id: productId,
        event_type: "CLICK",
        payload: { aify_event: type, ...payload },
      }),
    });
    const text = await res.text();
    const result = extractVerdict(text);
    console.log("[aify:cdp]", type, result);
    renderDebug(result);
  } catch (err) {
    console.warn("[aify:cdp] proxy unreachable", err);
  }
}

export function configureCdp(customerId, pageHandle, url = DEFAULT_PROXY_URL) {
  shopperId = customerId ? `SHP:${customerId}` : null;
  productId = pageHandle ? `PRD:${pageHandle}` : null;
  proxyUrl = url;
  window.addEventListener("aify:event", (e) => sendEvent(e.detail.type, e.detail));
}
