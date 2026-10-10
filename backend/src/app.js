import express from "express";
import cors from "cors";
import { scoreEvents } from "./scoring.js";
import { QUESTIONS, ASK_THRESHOLD } from "./questions.js";

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

  app.get("/sessions/:client_id", (req, res) => {
    const events = getSessionEvents(req.params.client_id);
    res.json({ session_id: req.params.client_id, events });
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

    const product = req.query.product;
    let events = getSessionEvents(clientId);
    if (product) {
      // Score against this product's own signals plus session-wide ones
      // (e.g. page_viewed on the home page), not another product's.
      events = events.filter((e) => !e.product_handle || e.product_handle === product);
    }
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
    const { session_id, question_id, answer_id } = req.body || {};
    if (!session_id || !question_id || !answer_id) {
      return res.status(400).json({
        error: "session_id, question_id and answer_id are required",
      });
    }
    insertAnswer.run({ session_id, question_id, answer_id });
    // Ontology lookup (verified attributes for this answer) lands in T14/T15.
    res.status(201).json({ session_id, question_id, answer_id, stored: true });
  });

  return app;
}
