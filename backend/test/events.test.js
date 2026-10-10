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

test("POST /events requires session_id and event_name", async () => {
  const server = await startServer();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  await closeServer(server);
});

test("POST /events stores an event, GET /sessions/:id returns it in order", async () => {
  const server = await startServer();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const sessionId = "test-session-1";

  await fetch(`${base}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      event_name: "page_viewed",
      payload: { template: "index" },
    }),
  });
  await fetch(`${base}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      event_name: "product_viewed",
      product_handle: "smooth-operator-aha-serum",
    }),
  });

  const res = await fetch(`${base}/sessions/${sessionId}`);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.session_id, sessionId);
  assert.equal(data.events.length, 2);
  assert.equal(data.events[0].event_name, "page_viewed");
  assert.deepEqual(data.events[0].payload, { template: "index" });
  assert.equal(data.events[1].event_name, "product_viewed");
  assert.equal(data.events[1].product_handle, "smooth-operator-aha-serum");
  assert.ok(data.scores, "expected live scores alongside the timeline");
  assert.deepEqual(data.answers, []);

  await closeServer(server);
});

test("GET /sessions/:id returns empty events for an unknown session", async () => {
  const server = await startServer();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/sessions/unknown-session`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.events, []);
  await closeServer(server);
});

test("GET /sessions/:id renders HTML for a browser Accept header", async () => {
  const server = await startServer();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/sessions/demo-session`, {
    headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  });
  const contentType = res.headers.get("content-type");
  const body = await res.text();
  assert.ok(contentType.includes("text/html"));
  assert.ok(body.includes("Session: demo-session"));
  await closeServer(server);
});

test("GET /sessions/:id?format=json always returns JSON even with an HTML Accept header", async () => {
  const server = await startServer();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/sessions/demo-session?format=json`, {
    headers: { Accept: "text/html" },
  });
  const data = await res.json();
  assert.equal(data.session_id, "demo-session");
  await closeServer(server);
});
