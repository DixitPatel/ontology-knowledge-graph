#!/usr/bin/env node
// Phase 3 gate: a Playwright session produces ordered events in /sessions/:id.
import { chromium } from "playwright";

const THEME_URL = process.env.THEME_URL || "http://127.0.0.1:9292";
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8787";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Visiting home");
  await page.goto(`${THEME_URL}/`, { waitUntil: "load" });
  await page.waitForSelector("text=Your 2-step routine", { state: "attached" });

  console.log("Visiting product page: smooth-operator-aha-serum");
  await page.goto(`${THEME_URL}/products/smooth-operator-aha-serum`, { waitUntil: "load" });
  await page.waitForSelector("text=Am I for you?", { state: "attached" });

  console.log("Opening the What's Inside collapsible section");
  await page.locator('details[data-oneself-section="whats_inside"] summary').click();
  await page.waitForTimeout(300);

  console.log("Adding to cart");
  const addToCart = page.waitForResponse((res) => res.url().includes("/cart/add"));
  await page.click('button[name="add"]');
  await addToCart;

  console.log("Visiting cart");
  await page.goto(`${THEME_URL}/cart`, { waitUntil: "load" });
  await page.waitForSelector("text=Smooth Operator AHA Serum", { state: "attached" });

  const sessionId = await page.evaluate(() => window.localStorage.getItem("oneself_sid"));
  if (!sessionId) throw new Error("No oneself_sid found in localStorage");
  console.log(`Session id: ${sessionId}`);

  await browser.close();

  // sendBeacon delivery is fire-and-forget; give it a moment to land.
  await new Promise((r) => setTimeout(r, 1000));

  const res = await fetch(`${BACKEND_URL}/sessions/${sessionId}`);
  const data = await res.json();
  const names = data.events.map((e) => e.event_name);
  console.log("Events recorded, in order:", names.join(" -> "));

  const required = ["page_viewed", "product_viewed", "oneself:section_opened", "product_added_to_cart", "cart_viewed"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing expected events: ${missing.join(", ")}. Got: ${names.join(", ")}`);
  }

  // Ordering sanity check: page_viewed should come before product_added_to_cart.
  const firstPageView = names.indexOf("page_viewed");
  const addedToCart = names.indexOf("product_added_to_cart");
  if (!(firstPageView < addedToCart)) {
    throw new Error("Events are not in the expected chronological order");
  }

  console.log("Phase 3 gate passed: session events recorded in order via /sessions/:id.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
