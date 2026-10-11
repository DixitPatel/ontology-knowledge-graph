# Local proxy: tab -> this proxy -> Cortex Agent (key stays on the server).
# pip install fastapi uvicorn httpx pyjwt cryptography
# Run: SF_ACCOUNT=<org-account> SF_USER=<user> uvicorn agent_proxy:app --port 8787
import base64, hashlib, json, os, re, time
import httpx, jwt
from cryptography.hazmat.primitives import serialization
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

ACCOUNT = os.environ["SF_ACCOUNT"]            # e.g. myorg-rs56916
USER = os.environ["SF_USER"].upper()
KEY_PATH = os.path.expanduser(os.environ.get("SF_KEY", "~/.snowflake/keys/rsa_key.p8"))
BASE = f"https://{ACCOUNT.lower()}.snowflakecomputing.com"
AGENT_URL = f"{BASE}/api/v2/databases/SKINCARE_KG/schemas/KG/agents/CDP_AGENT:run"
FIT_AGENT_URL = f"{BASE}/api/v2/databases/SKINCARE_KG/schemas/KG/agents/FIT_AGENT:run"
SQL_URL = f"{BASE}/api/v2/statements"

GUIDANCE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ontology", "guidance.json")
with open(GUIDANCE_PATH) as f:
    GUIDANCE = json.load(f)

with open(KEY_PATH, "rb") as f:
    PRIVATE_KEY = serialization.load_pem_private_key(f.read(), password=None)
PUB_DER = PRIVATE_KEY.public_key().public_bytes(
    serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
FP = "SHA256:" + base64.b64encode(hashlib.sha256(PUB_DER).digest()).decode()
QUALIFIED = f"{ACCOUNT.split('.')[0].upper()}.{USER}"

def token() -> str:
    now = int(time.time())
    return jwt.encode({"iss": f"{QUALIFIED}.{FP}", "sub": QUALIFIED,
                       "iat": now, "exp": now + 3500}, PRIVATE_KEY, algorithm="RS256")

def headers():
    return {"Authorization": f"Bearer {token()}",
            "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
            "Content-Type": "application/json", "Accept": "text/event-stream"}

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/event")
async def event(req: Request):
    """Body: {shopper_id, product_id, event_type, payload}. Streams agent SSE back."""
    ev = await req.json()
    body = {"messages": [{"role": "user",
                          "content": [{"type": "text", "text": json.dumps(ev)}]}]}
    async def stream():
        buf = bytearray()
        t0 = time.time()
        print(f"[event] {ev.get('event_type')} {json.dumps(ev.get('payload'))}", flush=True)
        async with httpx.AsyncClient(timeout=60) as c:
            async with c.stream("POST", AGENT_URL, headers=headers(), json=body) as r:
                async for chunk in r.aiter_bytes():
                    buf.extend(chunk)
                    yield chunk
        log_agent_trace(buf.decode("utf-8", "replace"), time.time() - t0)
    return StreamingResponse(stream(), media_type="text/event-stream")


def _find(obj, key):
    """First dict (depth-first) that has `key`."""
    stack = [obj]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            if key in cur:
                return cur
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
    return None


def log_agent_trace(sse: str, secs: float):
    """Print tool calls, tool results and the final reply to the uvicorn console."""
    name = None
    for line in sse.splitlines():
        if line.startswith("event: "):
            name = line[7:].strip()
            continue
        if not line.startswith("data: ") or name not in ("response.tool_use", "response.tool_result", "response.text"):
            continue
        try:
            d = json.loads(line[6:])
        except ValueError:
            continue
        if name == "response.tool_use":
            u = _find(d, "input") or {}
            print(f"  -> {u.get('name')} {json.dumps(u.get('input'))[:200]}", flush=True)
        elif name == "response.tool_result":
            res = (_find(d.get("content"), "result") or {}).get("result", d.get("content"))
            print(f"  <- {d.get('name', '')} [{d.get('status', '')}] {json.dumps(res)[:200]}", flush=True)
        else:
            print(f"  reply {d.get('text', '')[:300]}", flush=True)
    print(f"  done in {secs:.1f}s", flush=True)

@app.post("/answer")
async def answer(req: Request):
    """Fast path for yes/no answers: bypasses the LLM."""
    a = await req.json()
    stmt = {"statement": "CALL SKINCARE_KG.KG.RECORD_ANSWER(?, ?, ?)",
            "bindings": {"1": {"type": "TEXT", "value": a["shopper_id"]},
                         "2": {"type": "TEXT", "value": a["question_id"]},
                         "3": {"type": "TEXT", "value": a["answer"]}},
            "warehouse": "KG_WH", "role": "KG_DEV"}
    h = headers() | {"Accept": "application/json"}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(SQL_URL, headers=h, json=stmt)
    return r.json()

PROFILE_SQL = """
SELECT e.EDGE_TYPE, e.DST_ID, n.NODE_TYPE, n.NAME, e.PROPS, n.PROPS, e.CONFIDENCE
FROM SKINCARE_KG.KG.KG_EDGE e JOIN SKINCARE_KG.KG.KG_NODE n ON n.NODE_ID = e.DST_ID
WHERE e.SRC_ID = ? AND e.STATUS IN ('ASSERTED', 'ACCEPTED')
UNION ALL
SELECT 'SELF', NODE_ID, NODE_TYPE, NAME, NULL, PROPS, NULL
FROM SKINCARE_KG.KG.KG_NODE WHERE NODE_ID = ?
"""

def _json(v):
    return json.loads(v) if v else None

@app.get("/profile/{shopper_id}")
async def profile(shopper_id: str):
    """Read path for the panel: one SQL read over KG_EDGE/KG_NODE, no LLM."""
    stmt = {"statement": PROFILE_SQL,
            "bindings": {"1": {"type": "TEXT", "value": shopper_id},
                         "2": {"type": "TEXT", "value": shopper_id}},
            "warehouse": "KG_WH", "role": "KG_DEV"}
    h = headers() | {"Accept": "application/json"}
    t0 = time.time()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(SQL_URL, headers=h, json=stmt)
    data = r.json().get("data") or []
    edges, shopper = [], None
    for et, dst, ntype, name, eprops, nprops, conf in data:
        row = {"edge": et, "id": dst, "type": ntype, "name": name,
               "props": _json(eprops) or {}, "node_props": _json(nprops) or {},
               "confidence": float(conf) if conf is not None else None}
        if et == "SELF":
            shopper = row
        else:
            edges.append(row)
    return {"shopper_id": shopper_id, "shopper": shopper, "edges": edges,
            "ms": int((time.time() - t0) * 1000)}

def extract_json_reply(sse: str, key: str = "verdict"):
    """Same approach as am-i-for-you-cdp.js's extractReply(): the agent's
    reply JSON sits as an escaped string inside one SSE event's text
    block, possibly fenced in ``` ```. Walk every data line's parsed
    object for a string that itself parses as a dict containing `key`;
    the last match wins.
    """
    found = None
    for line in sse.splitlines():
        if not line.startswith("data: "):
            continue
        try:
            event = json.loads(line[6:])
        except ValueError:
            continue
        stack = [event]
        while stack:
            cur = stack.pop()
            if isinstance(cur, str):
                s = re.sub(r"^```(?:json)?\s*|\s*```$", "", cur.strip())
                if s.startswith("{") and f'"{key}"' in s:
                    try:
                        parsed = json.loads(s)
                        if isinstance(parsed, dict) and key in parsed:
                            found = parsed
                    except ValueError:
                        pass
            elif isinstance(cur, list):
                stack.extend(cur)
            elif isinstance(cur, dict):
                stack.extend(cur.values())
    return found

@app.post("/fit")
async def fit(req: Request):
    """Body: {shopper_id, product_handle, panel_context}. Not streamed --
    buffers the FIT_AGENT reply, parses the final verdict JSON, and
    returns {answer, ms} (or {answer: null, error, ms} on failure) with
    HTTP 200 either way, so the UI can always show a fallback.
    """
    body = await req.json()
    t0 = time.time()
    try:
        shopper_id = body["shopper_id"]
        product_handle = body["product_handle"]
        product_id = f"PRD:store:{product_handle}"
        by_product = GUIDANCE.get("by_product", {}).get(product_handle, {})
        used_sources = {e.get("source") for e in by_product.values() if isinstance(e, dict) and e.get("source")}
        guidance = {"by_product": by_product,
                    "sources": {k: v for k, v in GUIDANCE.get("sources", {}).items() if k in used_sources}} if by_product else {}
        message = {"shopper_id": shopper_id, "product_id": product_id,
                   "panel_context": body.get("panel_context", {}), "guidance": guidance}
        agent_body = {"messages": [{"role": "user", "content": [{"type": "text", "text": json.dumps(message)}]}]}
        async with httpx.AsyncClient(timeout=45) as c:
            r = await c.post(FIT_AGENT_URL, headers=headers(), json=agent_body)
        sse = r.text
        log_agent_trace(sse, time.time() - t0)
        answer = extract_json_reply(sse, "verdict")
        ms = int((time.time() - t0) * 1000)
        if answer is None:
            return {"answer": None, "error": "no parsable reply", "ms": ms}
        return {"answer": answer, "ms": ms}
    except httpx.TimeoutException:
        return {"answer": None, "error": "timeout", "ms": int((time.time() - t0) * 1000)}
    except Exception as err:
        return {"answer": None, "error": str(err), "ms": int((time.time() - t0) * 1000)}

@app.get("/health")
def health():
    return {"ok": True, "agent": AGENT_URL}
