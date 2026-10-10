import express from "express";
import cors from "cors";

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

  app.get("/sessions/:client_id", (req, res) => {
    const rows = selectSessionEvents.all(req.params.client_id);
    const events = rows.map((row) => ({
      event_name: row.event_name,
      product_handle: row.product_handle,
      payload: row.payload ? JSON.parse(row.payload) : null,
      created_at: row.created_at,
    }));
    res.json({ session_id: req.params.client_id, events });
  });

  return app;
}
