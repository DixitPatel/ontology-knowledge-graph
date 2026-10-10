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

test("POST /answers requires session_id, question_id and answer_id", async () => {
  const server = await startServer();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "s1" }),
  });
  assert.equal(res.status, 400);
  await closeServer(server);
});

test("POST /answers stores the answer", async () => {
  const server = await startServer();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const res = await fetch(`${base}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: "answers-session-1",
      question_id: "irritation_risk",
      answer_id: "yes",
    }),
  });
  const data = await res.json();

  assert.equal(res.status, 201);
  assert.equal(data.stored, true);
  assert.equal(data.question_id, "irritation_risk");
  assert.equal(data.answer_id, "yes");

  await closeServer(server);
});

test("POST /answers with a sensitive answer on the AHA serum returns the not-verified ontology result", async () => {
  const server = await startServer();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const res = await fetch(`${base}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: "answers-session-2",
      question_id: "skin_type_fit",
      answer_id: "sensitive",
      product_handle: "smooth-operator-aha-serum",
    }),
  });
  const data = await res.json();

  assert.equal(res.status, 201);
  assert.equal(data.ontology.avoid, true);
  assert.deepEqual(data.ontology.verified, {});
  assert.equal(data.ontology.message, "We don't have verified information to confirm this.");

  await closeServer(server);
});
