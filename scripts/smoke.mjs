#!/usr/bin/env node
// Phase 2 gate: walk home -> shop -> product -> add to cart -> cart with no console errors.
import { chromium } from "playwright";

const BASE_URL = process.env.THEME_URL || "http://127.0.0.1:9292";

// Platform noise present on any fresh Partner dev store (missing customer
// account menu, Shop Pay widget CORS/CSP, etc.) -- unrelated to this theme's
// code and present on an unmodified Dawn install too.
const IGNORED_PATTERNS = [
  /customer-account-main-menu/,
  /shopifycloud\/storefront/,
  /shop\.app/,
  /Failed to load resource/,
];

function isIgnored(text) {
  return IGNORED_PATTERNS.some((re) => re.test(text));
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isIgnored(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    if (!isIgnored(String(err))) consoleErrors.push(String(err));
  });

  console.log(`Visiting home: ${BASE_URL}/`);
  await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
  await page.waitForSelector("text=Your daily skincare routine");

  console.log("Visiting shop (Shop All collection)");
  await page.goto(`${BASE_URL}/collections/shop-all`, { waitUntil: "load" });
  await page.waitForSelector("text=Smooth Operator AHA Serum");

  console.log("Visiting product page: smooth-operator-aha-serum");
  await page.goto(`${BASE_URL}/products/smooth-operator-aha-serum`, {
    waitUntil: "load",
  });
  await page.waitForSelector("text=Is this product right for you?");

  console.log("Adding product to cart");
  await page.click('button[name="add"]');
  await page.waitForTimeout(1000);

  console.log("Visiting cart");
  await page.goto(`${BASE_URL}/cart`, { waitUntil: "load" });
  await page.waitForSelector("text=Smooth Operator AHA Serum");

  await browser.close();

  if (consoleErrors.length > 0) {
    console.error("Console errors detected:");
    consoleErrors.forEach((e) => console.error(` - ${e}`));
    process.exit(1);
  }

  console.log("Smoke test passed: home -> shop -> product -> cart, no console errors.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
