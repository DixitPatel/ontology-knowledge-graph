# Local proxy: tab -> this proxy -> Cortex Agent (key stays on the server).
# pip install fastapi uvicorn httpx pyjwt cryptography
# Run: SF_ACCOUNT=<org-account> SF_USER=<user> uvicorn agent_proxy:app --port 8787
import base64, hashlib, json, os, time
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
SQL_URL = f"{BASE}/api/v2/statements"

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
        async with httpx.AsyncClient(timeout=60) as c:
            async with c.stream("POST", AGENT_URL, headers=headers(), json=body) as r:
                async for chunk in r.aiter_bytes():
                    yield chunk
    return StreamingResponse(stream(), media_type="text/event-stream")

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

@app.get("/health")
def health():
    return {"ok": True, "agent": AGENT_URL}
