import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";

function startServer() {
  const db = createDb(":memory:");
  const app = createApp(db);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function postEvent(base, body) {
  await fetch(`${base}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("GET /intent requires client_id", async () => {
  const server = await startServer();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/intent`);
  assert.equal(res.status, 400);
  await closeServer(server);
});

test("GET /intent: no signal -> ask false, general_browsing", async () => {
  const server = await startServer();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const sessionId = "intent-session-1";

  await postEvent(base, { session_id: sessionId, event_name: "page_viewed" });

  const res = await fetch(`${base}/intent?client_id=${sessionId}`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ask, false);
  assert.equal(data.question, null);
  assert.equal(data.scores.general_browsing, 1);

  await closeServer(server);
});

test("GET /intent: strong irritation_risk signal asks the right question", async () => {
  const server = await startServer();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const sessionId = "intent-session-2";

  await postEvent(base, {
    session_id: sessionId,
    event_name: "oneself:section_opened",
    product_handle: "smooth-operator-aha-serum",
    payload: { section_id: "whats_inside" },
  });
  await postEvent(base, {
    session_id: sessionId,
    event_name: "oneself:section_dwell",
    product_handle: "smooth-operator-aha-serum",
    payload: { section_id: "whats_inside", ms: 5000 },
  });

  const res = await fetch(`${base}/intent?client_id=${sessionId}&product=smooth-operator-aha-serum`);
  const data = await res.json();

  assert.equal(data.ask, true);
  assert.equal(data.question_id, "irritation_risk");
  assert.equal(data.question, "Has your skin reacted to acids before?");
  assert.ok(Array.isArray(data.options) && data.options.length > 0);

  await closeServer(server);
});

test("GET /intent persists scores to session_scores (reflected on repeat calls)", async () => {
  const server = await startServer();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const sessionId = "intent-session-3";

  await postEvent(base, {
    session_id: sessionId,
    event_name: "oneself:section_opened",
    payload: { section_id: "am_i_for_you" },
  });

  const first = await (await fetch(`${base}/intent?client_id=${sessionId}`)).json();
  const second = await (await fetch(`${base}/intent?client_id=${sessionId}`)).json();
  assert.deepEqual(first.scores, second.scores);

  await closeServer(server);
});
