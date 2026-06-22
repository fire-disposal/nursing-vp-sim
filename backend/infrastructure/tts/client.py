"""Volcengine Large Model TTS HTTP client.

Handles TTS synthesis via the Volcengine OpenSpeech API,
with Bearer-token authentication and binary audio response parsing.
"""

import json
import logging
import uuid
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts"


@dataclass
class TTSRequest:
    text: str
    voice_type: str = "zh_female_vv"
    emotion: str | None = None
    speech_rate: float = 1.0
    encoding: str = "mp3"


class VolcTTSClient:
    """Async client for Volcengine Large-Model TTS synthesis."""

    def __init__(
        self,
        app_id: str,
        token: str,
        cluster: str = "volcano_tts",
        timeout: int = 8,
    ):
        self._app_id = app_id
        self._token = token
        self._cluster = cluster
        self._timeout = timeout
        self._http: httpx.AsyncClient | None = None

    @property
    def http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout + 5, connect=10.0),
            )
        return self._http

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    def _build_body(self, req: TTSRequest) -> dict:
        body: dict = {
            "app": {
                "appid": self._app_id,
                "token": self._token,
                "cluster": self._cluster,
            },
            "user": {
                "uid": "nursing-vp-sim",
            },
            "audio": {
                "voice_type": req.voice_type,
                "encoding": req.encoding,
                "speed_ratio": req.speech_rate,
            },
            "request": {
                "reqid": uuid.uuid4().hex,
                "text": req.text,
                "text_type": "plain",
                "operation": "query",
            },
        }
        if req.emotion:
            body["audio"]["emotion"] = req.emotion
        return body

    async def synthesize(self, req: TTSRequest) -> bytes:
        """Synthesize speech from text. Returns raw audio bytes (MP3 by default).

        Raises httpx.HTTPStatusError on HTTP errors, RuntimeError on API-level errors.
        """
        body = self._build_body(req)
        body_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")

        resp = await self.http.post(
            TTS_ENDPOINT,
            content=body_bytes,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer;{self._token}",
            },
        )
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "")

        if "application/json" in content_type:
            data = resp.json()
            code = data.get("code", -1)
            if code != 3000:
                msg = data.get("message", "unknown error")
                log.error("TTS API error: code=%s message=%s", code, msg)
                raise RuntimeError(f"TTS synthesis failed: {msg}")
            audio_b64 = data.get("data", "")
            if not audio_b64:
                raise RuntimeError("TTS returned empty audio data")
            import base64

            return base64.b64decode(audio_b64)

        return resp.content

    async def health_check(self) -> bool:
        """Quick connectivity check using a minimal synthesis request."""
        try:
            audio = await self.synthesize(TTSRequest(text="测试", voice_type="zh_female_vv"))
            return len(audio) > 0
        except Exception:
            log.warning("TTS health check failed", exc_info=True)
            return False
