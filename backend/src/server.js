import { createApp } from "./app.js";
import { createDb } from "./db.js";

const PORT = process.env.PORT || 8787;

const db = createDb();
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`oneself backend listening on http://127.0.0.1:${PORT}`);
});
