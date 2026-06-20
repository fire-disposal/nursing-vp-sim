import json, urllib.request

# 1. Login
login_data = json.dumps({"username": "student1", "password": "123456"}).encode()
req = urllib.request.Request(
    "http://localhost:8000/api/auth/login",
    data=login_data,
    headers={"Content-Type": "application/json"},
)
resp = urllib.request.urlopen(req)
body = json.loads(resp.read())
print("Login response:", json.dumps(body, ensure_ascii=False)[:300])
token = body.get("token") or (body.get("data", {}).get("token")) or (body.get("data", {}).get("access_token"))
if not token:
    print("No token found, exiting")
    exit(1)

# 2. QA with RAG
qa_data = json.dumps({"question": "注射前如何消毒", "rag_enabled": True}).encode()
req = urllib.request.Request(
    "http://localhost:8000/api/qa/sessions",
    data=qa_data,
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
)
try:
    resp = urllib.request.urlopen(req)
    body = json.loads(resp.read())
    result = body.get("data", body)
    print("session_id:", result.get("session_id"))
    print("answer:", result.get("answer", "")[:300])
    citations = result.get("citations")
    print("citations:", json.dumps(citations, ensure_ascii=False)[:500] if citations else "None")
except Exception as e:
    print("ERROR:", e)
