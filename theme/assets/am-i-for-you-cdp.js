/* "Am I for you?" panel -- Snowflake CDP wiring.
 *
 * Turns panel events into KG writes via the Cortex Agent (CDP_AGENT v2,
 * docs/Snowflake_agent_writer.sql) behind the local proxy
 * (docs/Snowflake_agent_proxy.py). The agent only mutates the shopper's
 * personal KG and replies {writes, skipped}. After a write, onWrite()
 * lets the panel re-read /profile and redraw.
 *
 * Panel event            -> agent event
 *   profile_confirmation yes -> CONFIRM
 *   profile_change_text      -> FREE_TEXT {text}
 *   routine_node_selected (candidate) -> INTEREST {target: this product}
 * Everything else (open/close/tab views) is not sent.
 */

const DEFAULT_PROXY_URL = "http://127.0.0.1:8788";

let shopperId = null;
let productId = null;
let proxyUrl = DEFAULT_PROXY_URL;
let onWrite = () => {};
let debugEl = null;

function ensureDebugPanel() {
  if (debugEl) return debugEl;
  debugEl = document.createElement("div");
  debugEl.className = "aify-cdp-debug";
  debugEl.setAttribute("aria-live", "polite");
  debugEl.innerHTML = `<div class="aify-cdp-debug__head">KG writes (debug)</div><div class="aify-cdp-debug__body">waiting for events&hellip;</div>`;
  debugEl.querySelector(".aify-cdp-debug__head").onclick = () => debugEl.classList.toggle("aify-cdp-debug--collapsed");
  document.body.appendChild(debugEl);
  return debugEl;
}

function renderDebug(type, result, ms) {
  const el = ensureDebugPanel().querySelector(".aify-cdp-debug__body");
  if (!result) {
    el.textContent = `${type}: no parsable reply (${ms}ms)`;
    return;
  }
  const { writes = [], skipped = [] } = result;
  el.innerHTML = `
    <div><strong>${type}</strong> · ${ms}ms</div>
    ${writes.length ? `<ul>${writes.map((w) => `<li>${w.op} ${w.edge ?? ""} ${w.target ?? ""}</li>`).join("")}</ul>` : "<div>no writes</div>"}
    ${skipped.length ? `<div><strong>skipped:</strong> ${skipped.join("; ")}</div>` : ""}`;
}

// The agent's :run endpoint streams SSE "data: {...}" lines. The reply
// JSON sits as an escaped string inside one event's text block, so each
// data line is JSON.parsed first, then every string value is tried as
// JSON containing `key`. The last match wins.
export function extractReply(sseText, key = "writes") {
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
        const s = cur.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
        if (s.startsWith("{") && s.includes(`"${key}"`)) {
          try {
            const parsed = JSON.parse(s);
            if (parsed && key in parsed) found = parsed;
          } catch {
            // not the reply
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

async function send(eventType, payload) {
  if (!shopperId) return null;
  const t0 = performance.now();
  try {
    const res = await fetch(`${proxyUrl}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopper_id: shopperId, product_id: productId, event_type: eventType, payload }),
    });
    const result = extractReply(await res.text());
    const ms = Math.round(performance.now() - t0);
    console.log("[aify:kg]", eventType, result, `${ms}ms`);
    renderDebug(eventType, result, ms);
    window.dispatchEvent(new CustomEvent("aify:kg", { detail: { eventType, result } }));
    if (result?.writes?.length) await onWrite(result);
    return result;
  } catch (err) {
    console.warn("[aify:kg] proxy unreachable", err);
    window.dispatchEvent(new CustomEvent("aify:kg", { detail: { eventType, result: null, error: true } }));
    return null;
  }
}

// PURE: panel event -> [agent event_type, payload] or null (not sent).
export function toAgentEvent(detail, product) {
  if (detail.type === "profile_confirmation" && detail.answer === "yes") return ["CONFIRM", {}];
  if (detail.type === "profile_change_text" && detail.text?.trim()) return ["FREE_TEXT", { text: detail.text.trim() }];
  if (detail.type === "routine_node_selected" && detail.node === "candidate" && product) return ["INTEREST", { target: product }];
  return null;
}

export function configureCdp(customerId, pageHandle, url = DEFAULT_PROXY_URL, writeHandler) {
  shopperId = customerId ? `SHP:${customerId}` : null;
  productId = pageHandle ? `PRD:store:${pageHandle}` : null;
  proxyUrl = url || DEFAULT_PROXY_URL;
  if (writeHandler) onWrite = writeHandler;
  window.addEventListener("aify:event", (e) => {
    const ev = toAgentEvent(e.detail, productId);
    if (ev) send(...ev);
  });
}
