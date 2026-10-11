#!/usr/bin/env node
// Phase 5 gate: a "Sensitive" answer + unknown AHA strength -> the card
// shows the not-verified message, with no recommendation (no attributes).
import { chromium } from "playwright";

const THEME_URL = process.env.THEME_URL || "http://127.0.0.1:9292";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Visiting the AHA serum product page");
  await page.goto(`${THEME_URL}/products/smooth-operator-aha-serum`, { waitUntil: "load" });
  await page.waitForSelector("text=Is this product right for you?", { state: "attached" });

  console.log("Opening Is this product right for you");
  await page.locator('details[data-oneself-section="am_i_for_you"] summary').click();

  console.log("Waiting for the skin_type_fit prompt");
  await page.waitForSelector("#oneself-intent-prompt:not([hidden])", { timeout: 10000 });
  const question = await page.locator(".oneself-intent-prompt__question").textContent();
  if (!question.includes("skin like")) {
    throw new Error(`Expected the skin_type_fit question, got: "${question}"`);
  }

  console.log('Answering "Sensitive"');
  const answered = page.waitForResponse((res) => res.url().includes("/answers"));
  await page.getByText("Sensitive", { exact: true }).click();
  const ontology = (await (await answered).json()).ontology;
  console.log("Ontology result:", JSON.stringify(ontology));

  if (ontology.avoid !== true) {
    throw new Error("Expected avoid: true for a sensitive answer on an unverified-strength AHA product");
  }
  if (Object.keys(ontology.verified).length !== 0) {
    throw new Error(`Expected no recommended attributes, got: ${JSON.stringify(ontology.verified)}`);
  }
  if (ontology.message !== "We don't have verified information to confirm this.") {
    throw new Error(`Unexpected message: ${ontology.message}`);
  }

  await page.waitForTimeout(300);
  const resultHidden = await page.locator(".oneself-intent-prompt__result").evaluate((el) => el.hidden);
  const attributeCount = await page.locator(".oneself-intent-prompt__result-attributes li").count();
  const shownMessage = await page.locator(".oneself-intent-prompt__result-message").textContent();

  if (resultHidden) throw new Error("Expected the result panel to be visible");
  if (attributeCount !== 0) throw new Error(`Expected 0 recommended attributes shown, got ${attributeCount}`);
  if (!shownMessage.includes("don't have verified information")) {
    throw new Error(`Expected the not-verified message on screen, got: "${shownMessage}"`);
  }

  await browser.close();
  console.log("Phase 5 gate passed: Sensitive + unverified AHA strength -> not-verified message, no recommendation.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
