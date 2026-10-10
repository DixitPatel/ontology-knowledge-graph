import express from "express";
import cors from "cors";
import { scoreEvents } from "./scoring.js";
import { QUESTIONS, ASK_THRESHOLD } from "./questions.js";
import { getOntologyResult } from "./ontology.js";
import { renderSessionDebugHtml } from "./debugView.js";

const ALLOWED_ORIGINS = [
  "http://127.0.0.1:9292",
  "http://localhost:9292",
  `https://${process.env.STORE || "oneself-kczbrdsl.myshopify.com"}`,
];

export function createApp(db) {
  const app = express();

  app.use(
    cors({
      origin: ALLOWED_ORIGINS,
      credentials: true,
    })
  );
  // sendBeacon doesn't reliably set an application/json content-type, so
  // parse the body as JSON regardless of the declared content-type.
  app.use(express.json({ type: () => true }));

  const insertEvent = db.prepare(
    `INSERT INTO events (session_id, event_name, product_handle, payload)
     VALUES (@session_id, @event_name, @product_handle, @payload)`
  );

  app.post("/events", (req, res) => {
    const { session_id, event_name, product_handle, payload } = req.body || {};
    if (!session_id || !event_name) {
      return res.status(400).json({ error: "session_id and event_name are required" });
    }
    insertEvent.run({
      session_id,
      event_name,
      product_handle: product_handle ?? null,
      payload: payload ? JSON.stringify(payload) : null,
    });
    res.status(204).end();
  });

  const selectSessionEvents = db.prepare(
    `SELECT event_name, product_handle, payload, created_at
     FROM events
     WHERE session_id = ?
     ORDER BY created_at ASC, id ASC`
  );

  function getSessionEvents(sessionId) {
    return selectSessionEvents.all(sessionId).map((row) => ({
      event_name: row.event_name,
      product_handle: row.product_handle,
      payload: row.payload ? JSON.parse(row.payload) : null,
      created_at: row.created_at,
    }));
  }

  const selectSessionAnswers = db.prepare(
    `SELECT question_id, answer_id, created_at
     FROM answers
     WHERE session_id = ?
     ORDER BY created_at ASC, id ASC`
  );

  app.get("/sessions/:client_id", (req, res) => {
    const sessionId = req.params.client_id;
    const events = getSessionEvents(sessionId);
    const answers = selectSessionAnswers.all(sessionId);
    const { scores } = scoreEvents(events);

    // Only an actual browser navigation sends a literal "text/html" Accept
    // header; fetch()/curl default to "*/*", which should still get JSON
    // (session-check.mjs and friends depend on that).
    const wantsHtml = req.query.format !== "json" && (req.headers.accept || "").includes("text/html");
    if (wantsHtml) {
      return res.send(renderSessionDebugHtml(sessionId, events, answers, scores));
    }
    res.json({ session_id: sessionId, events, answers, scores });
  });

  const upsertSessionScores = db.prepare(
    `INSERT INTO session_scores (session_id, scores, updated_at)
     VALUES (@session_id, @scores, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(session_id) DO UPDATE SET scores = @scores, updated_at = excluded.updated_at`
  );

  app.get("/intent", (req, res) => {
    const clientId = req.query.client_id;
    if (!clientId) {
      return res.status(400).json({ error: "client_id is required" });
    }

    // `product` (the page the shopper is currently on) isn't used to filter
    // scoring: where_to_start and value_check are inherently cross-product
    // (product_hop, cart churn on a different product while comparing), and
    // a shopper's prior worry about acids on one product page is still
    // relevant context on another. Score the whole session.
    const events = getSessionEvents(clientId);
    const { scores, top } = scoreEvents(events);

    upsertSessionScores.run({ session_id: clientId, scores: JSON.stringify(scores) });

    const ask = top !== "general_browsing" && scores[top] >= ASK_THRESHOLD;
    const questionDef = ask ? QUESTIONS[top] : null;

    res.json({
      ask,
      question_id: ask ? top : null,
      question: questionDef ? questionDef.question : null,
      options: questionDef ? questionDef.options : null,
      scores,
    });
  });

  const insertAnswer = db.prepare(
    `INSERT INTO answers (session_id, question_id, answer_id)
     VALUES (@session_id, @question_id, @answer_id)`
  );

  app.post("/answers", (req, res) => {
    const { session_id, question_id, answer_id, product_handle } = req.body || {};
    if (!session_id || !question_id || !answer_id) {
      return res.status(400).json({
        error: "session_id, question_id and answer_id are required",
      });
    }
    insertAnswer.run({ session_id, question_id, answer_id });

    const ontology = product_handle
      ? getOntologyResult(question_id, answer_id, product_handle)
      : { verified: {}, unverified: [], avoid: false, message: null };

    res.status(201).json({ session_id, question_id, answer_id, stored: true, ontology });
  });

  return app;
}
