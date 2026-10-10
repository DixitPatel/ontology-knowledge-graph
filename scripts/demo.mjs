#!/usr/bin/env node
// Phase 6 gate: both demo-script.md shopper paths, run twice each via
// Playwright, no manual DB edits (the DB is populated entirely by the
// storefront JS as each run clicks through the site).
import { chromium } from "playwright";

const THEME_URL = process.env.THEME_URL || "http://127.0.0.1:9292";

async function runAhaWorryPath(browser) {
  // A fresh incognito context -> a fresh oneself_sid, fresh cart, fresh
  // sessionStorage, so each run is an independent simulated shopper.
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${THEME_URL}/`, { waitUntil: "load" });
  await page.waitForSelector("text=Your daily skincare routine", { state: "attached" });

  await page.goto(`${THEME_URL}/products/smooth-operator-aha-serum`, { waitUntil: "load" });
  await page.waitForSelector("text=Am I for you?", { state: "attached" });

  await page.locator('details[data-oneself-section="whats_inside"] summary').click();
  await page.waitForSelector("#oneself-intent-prompt:not([hidden])", { timeout: 10000 });

  const question = await page.locator(".oneself-intent-prompt__question").textContent();
  if (!question.includes("reacted to acids")) {
    throw new Error(`Path 1: expected the irritation_risk question, got "${question}"`);
  }

  const answered = page.waitForResponse((res) => res.url().includes("/answers"));
  await page.getByText("Yes", { exact: true }).click();
  const ontology = (await (await answered).json()).ontology;
  if (ontology.avoid !== true || Object.keys(ontology.verified).length !== 0) {
    throw new Error(`Path 1: expected an avoid/not-verified result, got ${JSON.stringify(ontology)}`);
  }

  const addToCart = page.waitForResponse((res) => res.url().includes("/cart/add"));
  await page.click('button[name="add"]');
  await addToCart;

  await page.goto(`${THEME_URL}/cart`, { waitUntil: "load" });
  await page.waitForSelector("text=Single product", { state: "attached" });

  await context.close();
  console.log("Path 1 (AHA worry): OK");
}

async function runWhichOneShouldIGetPath(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${THEME_URL}/products/smooth-operator-aha-serum`, { waitUntil: "load" });
  await page.waitForSelector("text=Am I for you?", { state: "attached" });

  await page.goto(`${THEME_URL}/products/cloud-whip-moisturiser`, { waitUntil: "load" });
  await page.waitForSelector("text=Am I for you?", { state: "attached" });

  // Cart churn: weighing the single moisturiser before deciding on the
  // bundle -- this is what tips the hypothesis to value_check rather than
  // where_to_start (hopping between any 2 of our 3 products feeds both).
  for (let i = 0; i < 3; i++) {
    const added = page.waitForResponse((res) => res.url().includes("/cart/add"));
    await page.click('button[name="add"]');
    await added;
  }

  await page.goto(`${THEME_URL}/products/glow-barrier-duo`, { waitUntil: "load" });
  await page.waitForSelector("#oneself-intent-prompt:not([hidden])", { timeout: 10000 });

  const question = await page.locator(".oneself-intent-prompt__question").textContent();
  if (!question.includes("help you decide")) {
    throw new Error(`Path 2: expected the value_check question, got "${question}"`);
  }

  const answered = page.waitForResponse((res) => res.url().includes("/answers"));
  await page.getByText("Bundle savings", { exact: true }).click();
  const ontology = (await (await answered).json()).ontology;
  if (!ontology.verified.price || !ontology.verified.bundle_contents) {
    throw new Error(`Path 2: expected verified price/bundle_contents, got ${JSON.stringify(ontology)}`);
  }

  const addToCart = page.waitForResponse((res) => res.url().includes("/cart/add"));
  await page.click('button[name="add"]');
  await addToCart;

  await page.goto(`${THEME_URL}/cart`, { waitUntil: "load" });
  await page.waitForSelector("text=Bundle", { state: "attached" });

  await context.close();
  console.log('Path 2 ("Which one should I get?"): OK');
}

async function main() {
  const browser = await chromium.launch();

  for (let run = 1; run <= 2; run++) {
    console.log(`--- Run ${run} ---`);
    await runAhaWorryPath(browser);
    await runWhichOneShouldIGetPath(browser);
  }

  await browser.close();
  console.log("Phase 6 gate passed: both demo paths ran twice with no manual DB edits.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
