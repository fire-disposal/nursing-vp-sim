import json
import os

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class EnvelopeMiddleware(BaseHTTPMiddleware):
    """Wraps all JSON responses in {code, data, message}.

    Streaming responses (SSE, CSV) and non-JSON responses pass through unchanged.
    FastAPI errors {detail: ...} are converted to {code: status_code, data: null, message: detail}.
    All other JSON responses become {code: 0, data: <original>, message: "success"}.

    Disabled when TESTING env var is set (test clients consume raw responses).
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        if os.getenv("TESTING"):
            return response
        content_type = response.headers.get("content-type", "")

        if not content_type.startswith("application/json"):
            return response

        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        data = json.loads(body) if body else None

        if isinstance(data, dict) and "detail" in data and response.status_code >= 400:
            wrapped = {
                "code": response.status_code,
                "data": None,
                "message": data["detail"],
            }
        else:
            wrapped = {"code": 0, "data": data, "message": "success"}

        wrapped_json = json.dumps(wrapped, ensure_ascii=False)
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        headers["content-length"] = str(len(wrapped_json.encode("utf-8")))
        return Response(
            content=wrapped_json,
            status_code=response.status_code,
            headers=headers,
            media_type="application/json",
        )
