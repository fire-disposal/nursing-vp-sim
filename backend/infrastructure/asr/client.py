"""Volcengine ASR (speech-to-text) client — HTTP one-shot recognition."""

import base64
import logging
import time
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

ASR_API_URL = "https://openspeech.bytedance.com/api/v1/asr"


class ASRError(Exception):
    pass


@dataclass
class ASRResult:
    text: str
    confidence: float  # 0.0-1.0
    is_final: bool
    duration_ms: int = 0


class VolcASRClient:
    def __init__(self, app_id: str, token: str, cluster: str = "volcengine", timeout: int = 15):
        self._app_id = app_id
        self._token = token
        self._cluster = cluster
        self._timeout = timeout
        self._http: httpx.AsyncClient | None = None

    @property
    def http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=10.0),
            )
        return self._http

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    async def recognize(
        self,
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
        resp = await self.http.post(
            ASR_API_URL,
            json=payload,
            headers={"Authorization": f"Bearer;{self._token}"},
        )
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        if resp.status_code != 200:
            raise ASRError(f"ASR HTTP {resp.status_code}: {resp.text[:500]}")

        data = resp.json()
        code = data.get("code", -1)
        if code != 1000:  # Volcengine success code
            raise ASRError(f"ASR API error code={code} msg={data.get('message', '')}")

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

    async def health_check(self) -> bool:
        try:
            small_silence = base64.b64decode("UklGRiQAAABXQVZF")
            result = await self.recognize(small_silence, fmt="wav", sample_rate=8000)
            return True
        except Exception:
            log.exception("ASR health check failed")
            return False
