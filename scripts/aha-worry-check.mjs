#!/usr/bin/env node
// Phase 4 gate: an "AHA worry" session -> the irritation_risk prompt shows
// -> the answer lands on the cart (attributes) and in the backend DB.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THEME_URL = process.env.THEME_URL || "http://127.0.0.1:9292";
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8787";
const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "backend", "oneself.db");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Visiting the AHA serum product page");
  await page.goto(`${THEME_URL}/products/smooth-operator-aha-serum`, { waitUntil: "load" });
  await page.waitForSelector("text=Am I for you?", { state: "attached" });

  console.log("Worrying about irritation: opening What's Inside (AHA / patch-test info)");
  await page.locator('details[data-oneself-section="whats_inside"] summary').click();

  console.log("Waiting for the intent prompt to appear");
  await page.waitForSelector("#oneself-intent-prompt:not([hidden])", { timeout: 10000 });

  const question = await page.locator(".oneself-intent-prompt__question").textContent();
  console.log(`Prompt question: "${question}"`);
  if (!question.includes("reacted to acids")) {
    throw new Error(`Expected the irritation_risk question, got: "${question}"`);
  }

  console.log('Answering "Yes" (had a reaction before)');
  const cartUpdate = page.waitForResponse((res) => res.url().includes("/cart/update.js"));
  await page.getByText("Yes", { exact: true }).click();
  await cartUpdate;

  console.log("Checking the cart attribute");
  const cart = await (await fetch(`${THEME_URL}/cart.js`, {
    headers: { Cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ") },
  })).json();
  const attrValue = cart.attributes && cart.attributes["oneself_intent_irritation_risk"];
  console.log(`Cart attribute oneself_intent_irritation_risk = ${attrValue}`);
  if (attrValue !== "yes") {
    throw new Error(`Expected cart attribute "yes", got: ${JSON.stringify(cart.attributes)}`);
  }

  const sessionId = await page.evaluate(() => window.localStorage.getItem("oneself_sid"));
  await browser.close();

  console.log("Checking the answer landed in the backend DB via /sessions/:id");
  await new Promise((r) => setTimeout(r, 500));
  const session = await (await fetch(`${BACKEND_URL}/sessions/${sessionId}`)).json();
  const answeredEvent = session.events.find((e) => e.event_name === "oneself:intent_answered");
  if (!answeredEvent || answeredEvent.payload.question_id !== "irritation_risk" || answeredEvent.payload.answer_id !== "yes") {
    throw new Error(`Expected an intent_answered event for irritation_risk/yes, got: ${JSON.stringify(session.events)}`);
  }

  console.log("Checking the answers table directly via sqlite3");
  const row = execFileSync(
    "sqlite3",
    [DB_PATH, `SELECT question_id, answer_id FROM answers WHERE session_id = '${sessionId}';`],
    { encoding: "utf8" }
  ).trim();
  console.log(`answers row: ${row}`);
  if (row !== "irritation_risk|yes") {
    throw new Error(`Expected "irritation_risk|yes" in the answers table, got: "${row}"`);
  }

  console.log("Phase 4 gate passed: irritation prompt shown, answer on cart attributes and in the DB.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
