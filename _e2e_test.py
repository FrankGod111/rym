# -*- coding: utf-8 -*-
import json, urllib.request, urllib.error, sys
sys.stdout.reconfigure(encoding="utf-8")
BASE = "http://127.0.0.1:8013"
Q = "".join(chr(c) for c in [0x94c1,0x8def,0x8425,0x4e1a,0x7ebf,0x65bd,0x5de5,0x662f,0x6307,0x4ec0,0x4e48])

def req(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8", "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=180) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = raw
        return e.code, payload

out = []
st, h = req("GET", "/health")
out.append("HEALTH %s %s" % (st, h))
st, login = req("POST", "/erp/v1/auth/login", {"username": "admin", "password": "admin"})
token = login.get("token") if isinstance(login, dict) else None
uname = login.get("user", {}).get("username") if isinstance(login, dict) else login
out.append("LOGIN %s token_ok=%s user=%s" % (st, bool(token), uname))
st, retrieve = req("POST", "/erp/v1/ai/retrieve", {"question": Q}, token=token)
chunks = retrieve.get("chunks") if isinstance(retrieve, dict) else []
n = len(chunks) if isinstance(chunks, list) else chunks
out.append("RETRIEVE status=%s count=%s" % (st, n))
if isinstance(chunks, list):
    for i, c in enumerate(chunks[:4]):
        text = c.get("content") or c.get("text") or str(c)
        out.append("CHUNK[%s] %s" % (i, text[:350]))
st, chat = req("POST", "/erp/v1/ai/chat", {"question": Q}, token=token)
out.append("CHAT status=%s" % st)
answer = chat.get("answer") if isinstance(chat, dict) else chat
out.append("===== AI CHAT ANSWER =====")
if isinstance(answer, str):
    out.append(answer)
else:
    out.append(json.dumps(chat, ensure_ascii=False, indent=2))
text = "\n".join(out)
open("_e2e_out.txt", "w", encoding="utf-8").write(text)
print(text)
