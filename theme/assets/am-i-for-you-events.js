/* "Am I for you?" panel -- event bus.
 * repo: src/am-i-for-you/events.js
 *
 * Output contract (handoff 6.2). All events dispatch on window as
 * CustomEvent("aify:event", {detail}). One listener here logs to
 * console; later it forwards to the CDP (zero-party write) and Coframe
 * (goals). Distinct from oneself-events.js, which tracks page-level
 * storefront analytics (session_id, page views, cart) -- this bus is
 * just for signals from inside the panel.
 *
 * configure() binds customer_id/page once at init so every call site
 * can just say emit(type, payload), per the handoff's emit(type,
 * payload) signature.
 */

let customerId = null;
let pageHandle = null;

export function configure(nextCustomerId, nextPageHandle) {
  customerId = nextCustomerId;
  pageHandle = nextPageHandle;
}

export function emit(type, payload = {}) {
  const detail = {
    type,
    customer_id: customerId,
    page: pageHandle,
    ts: new Date().toISOString(),
    ...payload,
  };
  window.dispatchEvent(new CustomEvent("aify:event", { detail }));
  console.log("[aify]", detail);
}
