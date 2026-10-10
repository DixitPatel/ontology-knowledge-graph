(function () {
  "use strict";

  var BACKEND_URL = window.ONESELF_BACKEND_URL;
  var TEMPLATE = window.ONESELF_TEMPLATE;
  var PRODUCT_HANDLE = window.ONESELF_PRODUCT_HANDLE || null;

  // --- session id -----------------------------------------------------
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getSessionId() {
    try {
      var sid = window.localStorage.getItem("oneself_sid");
      if (sid) return sid;
      sid = uuid();
      window.localStorage.setItem("oneself_sid", sid);
      return sid;
    } catch (e) {
      // localStorage unavailable (private mode, etc.) -- fall back to a cookie.
      var match = document.cookie.match(/(?:^|; )oneself_sid=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
      var fallback = uuid();
      document.cookie = "oneself_sid=" + encodeURIComponent(fallback) + "; path=/; max-age=31536000";
      return fallback;
    }
  }

  var SESSION_ID = getSessionId();

  // --- transport --------------------------------------------------------
  function sendEvent(eventName, options) {
    if (!BACKEND_URL) return;
    options = options || {};
    var body = JSON.stringify({
      session_id: SESSION_ID,
      event_name: eventName,
      product_handle: options.product_handle || null,
      payload: options.payload || null,
    });

    var url = BACKEND_URL + "/events";
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      }).catch(function () {});
    }

    // Let other scripts (e.g. intent-prompt.js) react to fresh signal
    // without each one re-implementing the transport/session-id logic.
    document.dispatchEvent(
      new CustomEvent("oneself:signal", { detail: { event_name: eventName } })
    );
  }

  window.OneselfEvents = {
    send: sendEvent,
    sessionId: SESSION_ID,
  };

  // --- standard events (via Shopify's standard-events.js, already wired
  // into Dawn's product/collection/cart components). These extend the
  // plain Event class and assign payload fields directly onto the event
  // instance (Object.assign(this, payload)) -- there is no `.detail`.
  document.addEventListener("shopify:page:view", function (e) {
    sendEvent("page_viewed", { payload: { template: e.page && e.page.template } });
  });

  document.addEventListener("shopify:product:view", function (e) {
    var product = e.product;
    if (!product) return;
    sendEvent("product_viewed", { product_handle: product.handle });
    // Only treat an actual product-page visit as a "hop" -- a related-product
    // or search-result card merely scrolling into view isn't the shopper
    // navigating between products.
    if (e.context === "page") trackProductHop(product.handle);
  });

  document.addEventListener("shopify:collection:view", function (e) {
    var collection = e.collection;
    sendEvent("collection_viewed", {
      payload: { collection_handle: collection && collection.handle },
    });
  });

  document.addEventListener("shopify:cart:view", function () {
    sendEvent("cart_viewed");
  });

  document.addEventListener("shopify:cart:lines-update", function (e) {
    var line = (e.lines || [])[0] || {};
    if (e.action === "add") {
      sendEvent("product_added_to_cart", {
        product_handle: TEMPLATE === "product" ? PRODUCT_HANDLE : null,
        payload: { variant_id: line.merchandiseId, quantity: line.quantity },
      });
    } else if (e.action === "remove") {
      sendEvent("product_removed_from_cart", {
        payload: { line_id: line.id, quantity: line.quantity },
      });
    }
  });

  document.addEventListener("click", function (e) {
    var target = e.target.closest && e.target.closest('[name="checkout"]');
    if (target) sendEvent("checkout_started");
  });

  // --- oneself: custom events ------------------------------------------

  // section_opened / section_dwell: any <details data-oneself-section>.
  var DWELL_MS = 5000;
  document.querySelectorAll("details[data-oneself-section]").forEach(function (details) {
    var sectionId = details.getAttribute("data-oneself-section");
    var dwellTimer = null;

    details.addEventListener("toggle", function () {
      if (details.open) {
        sendEvent("oneself:section_opened", {
          product_handle: PRODUCT_HANDLE,
          payload: { section_id: sectionId },
        });
        dwellTimer = window.setTimeout(function () {
          sendEvent("oneself:section_dwell", {
            product_handle: PRODUCT_HANDLE,
            payload: { section_id: sectionId, ms: DWELL_MS },
          });
        }, DWELL_MS);
      } else if (dwellTimer) {
        window.clearTimeout(dwellTimer);
        dwellTimer = null;
      }
    });
  });

  // scroll_depth: 25/50/75/100% milestones, once each per page load.
  var SCROLL_MILESTONES = [25, 50, 75, 100];
  var firedMilestones = {};
  var scrollTicking = false;

  function checkScrollDepth() {
    scrollTicking = false;
    var doc = document.documentElement;
    var scrollableHeight = doc.scrollHeight - window.innerHeight;
    if (scrollableHeight <= 0) return;
    var pct = Math.min(100, Math.round(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100));

    SCROLL_MILESTONES.forEach(function (milestone) {
      if (pct >= milestone && !firedMilestones[milestone]) {
        firedMilestones[milestone] = true;
        sendEvent("oneself:scroll_depth", {
          product_handle: PRODUCT_HANDLE,
          payload: { pct: milestone },
        });
      }
    });
  }

  window.addEventListener(
    "scroll",
    function () {
      if (scrollTicking) return;
      scrollTicking = true;
      window.requestAnimationFrame(checkScrollDepth);
    },
    { passive: true }
  );

  // product_hop: a different product viewed within 2 minutes of the last one.
  var HOP_WINDOW_MS = 2 * 60 * 1000;

  function trackProductHop(handle) {
    var key = "oneself_last_product";
    var now = Date.now();
    var last = null;
    try {
      last = JSON.parse(window.sessionStorage.getItem(key) || "null");
    } catch (e) {
      last = null;
    }

    if (last && last.handle !== handle && now - last.ts <= HOP_WINDOW_MS) {
      sendEvent("oneself:product_hop", {
        payload: { from: last.handle, to: handle },
      });
    }

    try {
      window.sessionStorage.setItem(key, JSON.stringify({ handle: handle, ts: now }));
    } catch (e) {
      // sessionStorage unavailable -- product_hop just won't fire this visit.
    }
  }
})();
