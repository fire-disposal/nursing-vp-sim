"""ASR 上游客户端 ↔ 本地假 SAUC 服务端（回环 WebSocket，绝不连火山）。

覆盖真实收发路径：握手头、首包 gzip JSON、正/负序号音频帧、终稿包识别、错误帧映射。
"""

from __future__ import annotations

import gzip
import json
import struct

import pytest
import websockets
from websockets.asyncio.server import serve

from infra.asr import protocol
from infra.asr.client import AsrSession, AsrUpstreamError


def _server_frame(payload: dict, *, seq: int = 1, last: bool = False, message_type: int = 0b1001) -> bytes:
    body = gzip.compress(json.dumps(payload, ensure_ascii=False).encode())
    flags = 0b0001 | (0b0010 if last else 0)
    header = bytes([0x11, (message_type << 4) | flags, 0x11, 0x00])
    return header + struct.pack(">i", seq) + struct.pack(">I", len(body)) + body


def _error_frame(code: int, message: str) -> bytes:
    body = gzip.compress(json.dumps({"error": message}).encode())
    header = bytes([0x11, 0xF0, 0x11, 0x00])  # SERVER_ERROR，无序号
    return header + struct.pack(">i", code) + struct.pack(">I", len(body)) + body


def _decode_client_frame(frame: bytes) -> dict:
    flags = frame[1] & 0x0F
    message_type = frame[1] >> 4
    compression = frame[2] & 0x0F
    offset = (frame[0] & 0x0F) * 4
    seq = None
    if flags & 0b01:
        seq = struct.unpack(">i", frame[offset : offset + 4])[0]
        offset += 4
    size = struct.unpack(">I", frame[offset : offset + 4])[0]
    body = frame[offset + 4 : offset + 4 + size]
    return {
        "message_type": message_type,
        "flags": flags,
        "seq": seq,
        "compression": compression,
        "raw_body": body,
        "body": gzip.decompress(body) if compression == 1 and body else body,
    }


class FakeSauc:
    """最小 SAUC 服务端：收首包 → 回一段 partial/definite → 收末包 → 回终稿。"""

    def __init__(self, *, fail_with: tuple[int, str] | None = None):
        self.headers: dict[str, str] | None = None
        self.frames: list[dict] = []
        self.fail_with = fail_with
        self.url = ""

    async def handler(self, ws) -> None:
        self.headers = {k.lower(): v for k, v in ws.request.headers.items()}
        if self.fail_with is not None:
            code, message = self.fail_with
            await ws.send(_error_frame(code, message))
            # 真实 SAUC 先推 error 帧、再关连接；这里同样等客户端断开，
            # 避免「发送即断开」的竞态掩盖 error 帧。
            try:
                await ws.recv()
            except websockets.exceptions.ConnectionClosed:
                pass
            return

        first = _decode_client_frame(await ws.recv())
        self.frames.append(first)
        # 首包确认：一句 interim
        await ws.send(_server_frame({"result": {"text": "我", "utterances": [{"text": "我", "definite": False}]}}))

        async for raw in ws:
            frame = _decode_client_frame(raw)
            self.frames.append(frame)
            if frame["flags"] == 0b0011 or (frame["seq"] is not None and frame["seq"] < 0):
                break

        await ws.send(
            _server_frame(
                {
                    "result": {
                        "text": "我头晕。",
                        "utterances": [{"text": "我头晕。", "definite": True}],
                    }
                },
                last=True,
            )
        )


@pytest.fixture
async def fake_sauc():
    fake = FakeSauc()
    async with serve(fake.handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        fake.url = f"ws://127.0.0.1:{port}/api/v3/sauc/bigmodel_async"
        yield fake


async def test_full_session_round_trip(fake_sauc):
    session = AsrSession(api_key="secret-key-123", url=fake_sauc.url, request_id="req-9")
    await session.connect()
    try:
        await session.send_full_request()
        await session.send_audio(b"\x01\x02\x03\x04")
        await session.send_audio(b"\x05\x06")
        await session.finish()
        await session.finish()  # 幂等：不重复发末包

        texts = []
        async for resp in session.receive():
            texts.extend(protocol.extract_transcript(resp.payload).definite)
    finally:
        await session.close()

    assert texts == ["我头晕。"]

    # 握手头：密钥/资源/请求 id 都在，且没被改写
    headers = fake_sauc.headers
    assert headers["x-api-key"] == "secret-key-123"
    assert headers["x-api-resource-id"] == "volc.seedasr.sauc.duration"
    assert headers["x-api-request-id"] == "req-9"

    # 帧序：full request(1) → audio(2) → audio(3) → 末包(-4)
    assert [f["seq"] for f in fake_sauc.frames] == [1, 2, 3, -4]
    assert fake_sauc.frames[0]["message_type"] == protocol.MessageType.CLIENT_FULL_REQUEST
    assert fake_sauc.frames[0]["compression"] == protocol.Compression.GZIP
    assert json.loads(fake_sauc.frames[0]["body"])["request"]["model_name"] == "bigmodel"
    assert fake_sauc.frames[1]["body"] == b"\x01\x02\x03\x04"
    assert fake_sauc.frames[3]["flags"] == protocol.MsgFlags.NEG_WITH_SEQUENCE


async def test_upstream_error_surfaces_without_key(fake_sauc):
    fake_sauc.fail_with = (45000001, "invalid audio")
    session = AsrSession(api_key="secret-key-123", url=fake_sauc.url, request_id="req-bad")
    await session.connect()
    try:
        with pytest.raises(AsrUpstreamError) as exc:
            await session.send_full_request()
    finally:
        await session.close()

    message = str(exc.value)
    assert "45000001" in message
    assert "invalid audio" in message
    assert "secret-key-123" not in message


async def test_missing_key_fails_fast():
    session = AsrSession(api_key="", url="ws://127.0.0.1:1/never")
    with pytest.raises(AsrUpstreamError):
        await session.connect()


async def test_connect_refused_is_upstream_error():
    session = AsrSession(api_key="k", url="ws://127.0.0.1:1/api/v3/sauc/bigmodel_async", connect_timeout=2)
    with pytest.raises(AsrUpstreamError) as exc:
        await session.connect()
    assert "k" not in str(exc.value)


async def test_audio_after_finish_rejected(fake_sauc):
    session = AsrSession(api_key="k", url=fake_sauc.url)
    await session.connect()
    try:
        await session.send_full_request()
        await session.finish()
        with pytest.raises(AsrUpstreamError):
            await session.send_audio(b"\x00")
    finally:
        await session.close()
