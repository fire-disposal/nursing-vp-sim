"""豆包 SAUC 流式 ASR（bigmodel_async）客户端。

一个实例 = 一路会话，生命周期跟随一次浏览器 WebSocket 连接：

    async with AsrSession(api_key=..., request_id=...) as sess:
        await sess.send_full_request()          # seq=1，gzip(JSON) 配置包
        while ...:
            await sess.send_audio(pcm)          # 正序号
        await sess.send_audio(b"", is_last=True)  # 负序号末包
        async for resp in sess.receive(): ...   # 上游 JSON 帧

密钥只在握手头里出现：不写日志、不进异常消息、不出现在任何返回值里。
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any, Self

import websockets

from infra.asr import protocol

if TYPE_CHECKING:
    from websockets.asyncio.client import ClientConnection

log = logging.getLogger(__name__)

ASR_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
ASR_RESOURCE_ID = "volc.seedasr.sauc.duration"

#: 上游首包（配置）应答超时：握手成功但服务端不认配置时不能把用户挂死。
CONNECT_TIMEOUT = 10.0
#: 服务端 8s 无音频包就结束会话 → 客户端收尾时最多等这么久拿终稿。
FINAL_WAIT_TIMEOUT = 6.0

#: 护理问诊常见词。SAUC 的直传热词与上下文合计上限 100 tokens，
#: 这里只放高频且易被识别成别字的口语表达，保持极短。
HOTWORDS: tuple[str, ...] = (
    "恶心",
    "呕吐",
    "眩晕",
    "胸闷",
    "心慌",
    "气促",
    "乏力",
    "食欲",
    "睡眠",
    "大小便",
    "月经",
    "过敏",
    "既往史",
    "家族史",
    "高血压",
    "糖尿病",
)


class AsrUpstreamError(RuntimeError):
    """上游拒绝或中途失败。消息里只放服务端 code/message，不含凭据。"""


def build_request_payload(request_id: str, *, uid: str | None = None) -> dict[str, Any]:
    """首包 JSON。固定 PCM16/16k/mono，单遍结果按增量返回。"""
    context = json.dumps({"hotwords": [{"word": w} for w in HOTWORDS]}, ensure_ascii=False)
    return {
        "user": {"uid": uid or request_id},
        "audio": {
            "format": "pcm",
            "codec": "raw",
            "rate": protocol.AUDIO_SAMPLE_RATE,
            "bits": protocol.AUDIO_BITS,
            "channel": protocol.AUDIO_CHANNELS,
        },
        "request": {
            "model_name": "bigmodel",
            "enable_nonstream": True,
            "enable_itn": True,
            "enable_punc": True,
            "enable_ddc": False,
            "show_utterances": True,
            "result_type": "single",
            "end_window_size": 800,
            "corpus": {"context": context},
        },
    }


def build_headers(api_key: str, request_id: str) -> dict[str, str]:
    return {
        "X-Api-Key": api_key,
        "X-Api-Resource-Id": ASR_RESOURCE_ID,
        "X-Api-Request-Id": request_id,
        "X-Api-Connect-Id": request_id,
    }


class AsrSession:
    """一路 SAUC 会话（未连接 → 连接 → 发送/接收 → 关闭）。"""

    def __init__(
        self,
        *,
        api_key: str,
        url: str = ASR_WS_URL,
        connect_timeout: float = CONNECT_TIMEOUT,
        request_id: str | None = None,
    ) -> None:
        self._api_key = api_key
        self._url = url
        self._connect_timeout = connect_timeout
        self.request_id = request_id or uuid.uuid4().hex
        self._ws: ClientConnection | None = None
        self._next_seq = 1
        self._last_sent = False
        #: 已收到的终稿包标记（服务端 is_last_package 或负序号响应）
        self.finished = False

    # ── 连接 ──

    async def connect(self) -> None:
        if not self._api_key:
            raise AsrUpstreamError("ASR 未配置")
        try:
            ws = await asyncio.wait_for(
                websockets.connect(
                    self._url,
                    additional_headers=build_headers(self._api_key, self.request_id),
                    max_size=4 * 1024 * 1024,
                    open_timeout=self._connect_timeout,
                    ping_interval=20,
                    ping_timeout=20,
                    close_timeout=5,
                ),
                timeout=self._connect_timeout,
            )
        except TimeoutError:
            raise AsrUpstreamError("ASR 上游连接超时")
        except websockets.exceptions.InvalidStatus as e:
            # 握手阶段被拒（鉴权/资源）——只报状态码，绝不回显响应头（含 x-api-key 回显风险）。
            raise AsrUpstreamError(f"ASR 上游拒绝连接（HTTP {_status_of(e)}）")
        except (OSError, websockets.exceptions.WebSocketException) as e:
            raise AsrUpstreamError(f"ASR 上游连接失败: {type(e).__name__}")
        self._ws = ws
        self._next_seq = 1
        self._last_sent = False
        self.finished = False

    def _require_ws(self) -> ClientConnection:
        if self._ws is None:
            raise AsrUpstreamError("ASR 会话未连接")
        return self._ws

    @property
    def is_open(self) -> bool:
        ws = self._ws
        if ws is None:
            return False
        from websockets.protocol import State

        return ws.state is State.OPEN

    # ── 发送 ──

    async def send_full_request(self) -> None:
        """发送配置包并等待服务端确认，失败立刻暴露而不是拖到音频中段。"""
        ws = self._require_ws()
        payload = build_request_payload(self.request_id)
        try:
            await ws.send(protocol.build_full_request(payload, seq=self._next_seq))
        except websockets.exceptions.ConnectionClosed:
            # 服务端在握手后立刻推 error 帧并关闭：真正原因由下面的 recv 分支给出。
            raise AsrUpstreamError("ASR 上游在配置阶段断开")
        except (OSError, websockets.exceptions.WebSocketException) as e:
            raise AsrUpstreamError(f"ASR 上游发送失败: {type(e).__name__}")
        self._next_seq += 1

        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=self._connect_timeout)
        except TimeoutError:
            raise AsrUpstreamError("ASR 上游未响应配置包")
        except websockets.exceptions.ConnectionClosed:
            raise AsrUpstreamError("ASR 上游在配置阶段断开")
        if isinstance(raw, str):
            raise AsrUpstreamError("ASR 上游返回了非二进制帧")

        resp = _parse_or_raise(raw)
        if resp.message_type == protocol.MessageType.SERVER_ERROR or resp.code != 0:
            raise AsrUpstreamError(_error_message(resp))

    async def send_audio(self, segment: bytes) -> None:
        """发送一块 PCM。空块 + ``is_last`` 即末包标记。"""
        if self._last_sent:
            raise AsrUpstreamError("ASR 会话已发送末包")
        ws = self._require_ws()
        await ws.send(protocol.build_audio_request(segment, seq=self._next_seq))
        self._next_seq += 1

    async def finish(self) -> None:
        """发送负序号末包（幂等；空音频段即可作为纯结束标记）。"""
        if self._last_sent:
            return
        ws = self._require_ws()
        self._last_sent = True
        await ws.send(protocol.build_audio_request(b"", seq=self._next_seq, is_last=True))

    # ── 接收 ──

    async def receive(self) -> AsyncIterator[protocol.AsrResponse]:
        """逐帧产出上游响应，终稿包或 error 帧后结束。"""
        ws = self._require_ws()
        while True:
            try:
                raw = await ws.recv()
            except websockets.exceptions.ConnectionClosed:
                return
            if isinstance(raw, str):
                continue  # 非二进制帧（理论上没有）——跳过，别猜内容
            resp = _parse_or_raise(raw)
            if resp.message_type == protocol.MessageType.SERVER_ERROR or resp.code != 0:
                raise AsrUpstreamError(_error_message(resp))
            if resp.is_last or (resp.sequence is not None and resp.sequence < 0):
                self.finished = True
            yield resp
            if self.finished:
                return

    async def close(self) -> None:
        ws = self._ws
        self._ws = None
        if ws is None:
            return
        try:
            await ws.close()
        except (OSError, websockets.exceptions.WebSocketException):
            pass

    async def __aenter__(self) -> Self:
        await self.connect()
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.close()


def _parse_or_raise(raw: bytes) -> protocol.AsrResponse:
    try:
        return protocol.parse_response(raw)
    except protocol.ProtocolError as e:
        raise AsrUpstreamError(f"ASR 上游帧无法解析: {e}")


def _error_message(resp: protocol.AsrResponse) -> str:
    detail = ""
    if isinstance(resp.payload, dict):
        err = resp.payload.get("error") or resp.payload.get("message")
        if isinstance(err, str) and err:
            detail = err[:200]
        elif isinstance(resp.payload.get("message"), str):
            detail = resp.payload["message"][:200]
    return f"ASR 上游错误 code={resp.code}{(' ' + detail) if detail else ''}"


def _status_of(exc: Exception) -> int | str:
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", "?")
