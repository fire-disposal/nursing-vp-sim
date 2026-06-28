"""Volcengine SeedTTS 2.0 (doubao) TTS HTTP client — v3 unidirectional protocol.

Authenticates with the new console single ``X-Api-Key`` and streams audio
back as newline-delimited JSON, each line carrying a base64 audio chunk.
"""

import base64
import json
import logging
import threading
from dataclasses import dataclass, field

import httpx

from infrastructure.volc.auth import VOLC_BASE_URL, tts_headers

log = logging.getLogger(__name__)

TTS_ENDPOINT = f"{VOLC_BASE_URL}/api/v3/tts/unidirectional"

# Terminal status code emitted by the v3 unidirectional stream.
_CODE_DONE = 20000000


@dataclass
class TTSRequest:
    text: str
    speaker: str = "zh_female_vv_uranus_bigtts"
    speech_rate: int = 0  # integer [-50, 100]; 100 == 2.0x
    loudness_rate: int = 0  # integer [-50, 100]
    model: str = "seed-tts-2.0-standard"
    fmt: str = "mp3"  # mp3 / pcm / ogg_opus / wav
    sample_rate: int = 24000
    additions: dict = field(default_factory=dict)


class VolcTTSClient:
    """Async client for Volcengine SeedTTS 2.0 (v3) synthesis."""

    def __init__(
        self,
        api_key: str,
        resource_id: str = "seed-tts-2.0",
        timeout: int = 8,
    ):
        self._api_key = api_key
        self._resource_id = resource_id
        self._timeout = timeout
        self._http: httpx.AsyncClient | None = None
        self._http_lock = threading.Lock()

    @property
    def http(self) -> httpx.AsyncClient:
        if self._http is None:
            with self._http_lock:
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
        additions = json.dumps(req.additions, ensure_ascii=False) if req.additions else ""
        return {
            "req_params": {
                "text": req.text,
                "speaker": req.speaker,
                "additions": additions,
                "audio_params": {
                    "format": req.fmt,
                    "sample_rate": req.sample_rate,
                    "speech_rate": req.speech_rate,
                    "loudness_rate": req.loudness_rate,
                },
            }
        }

    async def synthesize(self, req: TTSRequest) -> bytes:
        """Synthesize speech from text, returning raw audio bytes.

        Parses the newline-delimited JSON stream: each ``code == 0`` line
        carries a base64 audio chunk, ``code == 20000000`` ends the stream,
        and any other positive code raises with the full response line logged.
        """
        body = self._build_body(req)
        body_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")

        resp = await self.http.post(
            TTS_ENDPOINT,
            content=body_bytes,
            headers=tts_headers(self._api_key, self._resource_id),
        )
        resp.raise_for_status()

        chunks: list[bytes] = []
        for line in resp.text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                log.warning("TTS: skipping non-JSON line: %.200s", line)
                continue

            code = payload.get("code", -1)
            if code == _CODE_DONE:
                break
            if code == 0:
                data_b64 = payload.get("data")
                if data_b64:
                    chunks.append(base64.b64decode(data_b64))
                continue
            # Any other positive code is an error — log the FULL line so we
            # never again lose the upstream error body (the v1 blind spot).
            log.error("TTS API error: %s", line)
            raise RuntimeError(f"TTS synthesis failed: code={code} body={line[:300]}")

        audio = b"".join(chunks)
        if not audio:
            raise RuntimeError("TTS returned empty audio data")
        return audio

    async def health_check(self, speaker: str | None = None) -> bool:
        """Quick connectivity check using a minimal synthesis request."""
        try:
            req = TTSRequest(text="测试")
            if speaker:
                req.speaker = speaker
            audio = await self.synthesize(req)
            return len(audio) > 0
        except Exception:
            log.warning("TTS health check failed", exc_info=True)
            return False
