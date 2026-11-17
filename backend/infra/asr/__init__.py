"""豆包 SAUC 流式 ASR 接入层。

``protocol``：二进制帧编解码与识别结果归一化（纯函数，可单测）；
``client``：一路上游会话（websockets，密钥只在握手头里）。
"""

from infra.asr.client import AsrSession, AsrUpstreamError

__all__ = ["AsrSession", "AsrUpstreamError"]
