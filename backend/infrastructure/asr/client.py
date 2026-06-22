"""Volcengine ASR (speech-to-text) client — HTTP one-shot recognition."""

import base64
import logging
import time
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

ASR_API_URL = "https://openspeech.bytedance.com/api/v1/asr"


@dataclass
class ASRResult:
    text: str
    confidence: float  # 0.0-1.0
    is_final: bool
    duration_ms: int = 0


class VolcASRClient:
    def __init__(self, app_id: str, token: str, cluster: str = "volcengine"):
        self._app_id = app_id
        self._token = token
        self._cluster = cluster

    async def recognize(
        self,
        http: httpx.AsyncClient,
        audio: bytes,
        fmt: str = "wav",
        sample_rate: int = 16000,
    ) -> ASRResult:
        audio_b64 = base64.b64encode(audio).decode("ascii")

        payload = {
            "app": {"appid": self._app_id, "token": self._token, "cluster": self._cluster},
            "user": {"uid": "nursing-vp-sim"},
            "audio": {
                "audio": audio_b64,
                "format": fmt,
                "rate": sample_rate,
            },
            "request": {"reqid": str(int(time.time() * 1000))},
        }

        t0 = time.perf_counter()
        resp = await http.post(ASR_API_URL, json=payload)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        if resp.status_code != 200:
            log.warning("ASR HTTP %d: %s", resp.status_code, resp.text[:500])
            return ASRResult(text="", confidence=0.0, is_final=True, duration_ms=elapsed_ms)

        data = resp.json()
        code = data.get("code", -1)
        if code != 1000:  # Volcengine success code
            log.warning("ASR API error code=%s msg=%s", code, data.get("message", ""))
            return ASRResult(text="", confidence=0.0, is_final=True, duration_ms=elapsed_ms)

        result = data.get("result", {})
        text = ""
        confidence = 0.0

        utterances = result.get("utterances", [])
        if utterances:
            texts = []
            total_conf = 0.0
            for u in utterances:
                t = u.get("text", "")
                texts.append(t)
                total_conf += u.get("confidence", 0.0)
            text = "".join(texts)
            confidence = round(total_conf / len(utterances), 4) if utterances else 0.0
        else:
            text = result.get("text", "")
            confidence = result.get("confidence", 0.0)

        return ASRResult(
            text=text,
            confidence=confidence,
            is_final=True,
            duration_ms=elapsed_ms,
        )

    async def health_check(self, http: httpx.AsyncClient) -> bool:
        try:
            small_silence = base64.b64decode("UklGRiQAAABXQVZF")
            result = await self.recognize(http, small_silence, fmt="wav", sample_rate=8000)
            return True
        except Exception:
            log.exception("ASR health check failed")
            return False
