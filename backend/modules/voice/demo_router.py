"""语音实验室（学生「电话」页）的路由 —— 独立于训练流程。

这是**特性完整的自由语音对话**，不是虚拟患者训练：没有病例、没有评分、没有问诊
进度、没有业务守卫，角色只是演示不同语气与音色。三条路由覆盖整条链路：

- ``GET  /api/voice-demo/characters``  四个虚构角色的权威定义（人设/音色在服务端）；
- ``POST /api/voice-demo/chat/stream`` 真实 LLM 自由对话（SSE，服务端不持久化）；
- ``POST /api/voice-demo/tts/stream``  逐句台词合成（PCM）。
云 ASR 在 ``asr_router.py``（``GET /api/voice-demo/asr``，与训练桥共用 ``_run_stream``）。

三者都复用训练路径的同一套基础设施与计费口径，差别只在：

- 没有 ``record_id``：请求里带了一律不读，既不查 ``TrainingRecord``，也不写训练消息；
- LLM 用独立用途 ``voice_demo``（独立 profile 与成本标签，不混进训练统计）；
- 情绪/分组由前端直接给出：``emotion_state`` → 提示词语气 + TTS ``context_texts``，
  ``section_id`` 串同一通电话的多轮合成上下文；
- 调用日志的 ``record_id`` 写 NULL，成本照常入账（运营面板因此仍看得到消耗）。
"""

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from core.budget import assert_within_budget
from core.deps import CurrentUser, DbSession
from core.exceptions import NotFoundError
from core.rate_limits import check_tts_limit
from infra.tts.circuit import CircuitOpenError
from modules.voice.demo_chat import stream_demo_reply
from modules.voice.demo_prompt import CHARACTERS, get_character
from modules.voice.service import TTSConnectionProvider, TTSService
from schemas.voice import VoiceDemoCharacterItem, VoiceDemoChatRequest, VoiceDemoTTSRequest

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice-demo", tags=["Voice Demo"])

#: 演示页不读写训练数据，只要求系统内已登录账号；权限/院校不参与这条链路。

#: 与训练流一致的 SSE 头：关掉代理缓冲与缓存，否则逐字下发会攒成一坨。
_SSE_HEADERS = {"X-Accel-Buffering": "no", "Cache-Control": "no-cache"}


@router.get("/characters")
async def list_characters(
    current_user: CurrentUser,
) -> list[VoiceDemoCharacterItem]:
    """四个虚构角色（人设与音色的唯一来源）。"""
    return [VoiceDemoCharacterItem(**c.to_public()) for c in CHARACTERS.values()]


@router.post(
    "/chat/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def chat_stream(
    req: VoiceDemoChatRequest,
    current_user: CurrentUser,
    db: DbSession,
    request: Request,
) -> StreamingResponse:
    """一轮自由语音对话（SSE）。校验全部在 200 之前完成，**不写任何数据库行**。"""
    assert_within_budget(db, current_user, "llm")
    db.rollback()  # 只读额度检查结束即释放；LLM 流式期间不持有事务

    character = get_character(req.character_id)
    if character is None:
        raise HTTPException(status_code=400, detail=f"未知角色：{req.character_id}")

    llm_client = getattr(request.app.state, "llm_client", None)
    if llm_client is None:
        raise NotFoundError("LLM 服务未配置，请先在管理面板添加模型配置")

    history = [item.model_dump() for item in req.history]
    return StreamingResponse(
        stream_demo_reply(
            llm_client=llm_client,
            character=character,
            history=history,
            emotion_state=req.emotion_state,
            user_id=current_user.id,
            session_id=req.session_id,
            long_response=req.test_mode == "long_response",
        ),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post(
    "/tts/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"audio/pcm": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def synthesize_demo_stream(
    req: VoiceDemoTTSRequest,
    current_user: CurrentUser,
    db: DbSession,
    request: Request,
) -> StreamingResponse:
    """逐句流式合成：PCM 24kHz mono 分块下发，与 ``/api/tts/stream`` 同协议。"""
    await check_tts_limit(current_user.id, request)
    assert_within_budget(db, current_user, "tts")

    pool: TTSConnectionProvider | None = getattr(request.app.state, "tts_pool", None)
    cfg = getattr(request.app.state, "tts_config", {})
    if not cfg:
        raise NotFoundError("TTS 未配置，请先在管理面板添加语音配置")

    try:
        info, gen = await TTSService(db).stream_synthesize_demo(
            text=req.text,
            emotion_state=req.emotion_state,
            section_id=req.section_id,
            user_id=current_user.id,
            pool=pool,
            timeout=cfg.get("timeout", 8),
            speaker=req.speaker,
            default_speaker=cfg.get("tts_speaker"),
        )
    except CircuitOpenError:
        raise HTTPException(status_code=503, detail="TTS 服务暂时不可用，已切换浏览器端语音")
    except TimeoutError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return StreamingResponse(
        gen,
        media_type=f"audio/pcm;rate={info.sample_rate}",
        headers={
            "X-TTS-Emotion": info.emotion,
            "X-TTS-Voice": info.speaker,
            "X-TTS-Sample-Rate": str(info.sample_rate),
        },
    )
