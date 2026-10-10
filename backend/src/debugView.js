function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreBar(label, score) {
  const pct = Math.round(score * 100);
  return `
    <div class="score-row">
      <span class="score-label">${escapeHtml(label)}</span>
      <div class="score-track"><div class="score-fill" style="width:${pct}%"></div></div>
      <span class="score-pct">${pct}%</span>
    </div>`;
}

export function renderSessionDebugHtml(sessionId, events, answers, scores) {
  const eventRows = events
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.created_at)}</td>
        <td>${escapeHtml(e.event_name)}</td>
        <td>${escapeHtml(e.product_handle || "")}</td>
        <td><code>${escapeHtml(e.payload ? JSON.stringify(e.payload) : "")}</code></td>
      </tr>`
    )
    .join("");

  const answerRows = answers
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(a.created_at)}</td>
        <td>${escapeHtml(a.question_id)}</td>
        <td>${escapeHtml(a.answer_id)}</td>
      </tr>`
    )
    .join("");

  const scoreBars = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([hypothesis, score]) => scoreBar(hypothesis, score))
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Session ${escapeHtml(sessionId)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; color: #222; }
  h1 { font-size: 1.2rem; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #eee; }
  th { color: #666; font-weight: 600; }
  code { font-size: 0.8rem; color: #555; }
  .score-row { display: flex; align-items: center; gap: 0.6rem; margin: 0.3rem 0; }
  .score-label { width: 11rem; font-size: 0.85rem; }
  .score-track { flex: 1; background: #eee; border-radius: 0.2rem; height: 0.9rem; }
  .score-fill { background: #3a7; height: 100%; border-radius: 0.2rem; }
  .score-pct { width: 3rem; text-align: right; font-size: 0.85rem; }
  .empty { color: #999; font-style: italic; }
</style>
</head>
<body>
  <h1>Session: ${escapeHtml(sessionId)}</h1>

  <h2>Live scores</h2>
  ${scoreBars || '<p class="empty">No scores yet.</p>'}

  <h2>Declared answers</h2>
  <table>
    <tr><th>Time</th><th>Question</th><th>Answer</th></tr>
    ${answerRows || '<tr><td class="empty" colspan="3">No answers yet.</td></tr>'}
  </table>

  <h2>Event timeline (${events.length})</h2>
  <table>
    <tr><th>Time</th><th>Event</th><th>Product</th><th>Payload</th></tr>
    ${eventRows || '<tr><td class="empty" colspan="4">No events yet.</td></tr>'}
  </table>
</body>
</html>`;
}
