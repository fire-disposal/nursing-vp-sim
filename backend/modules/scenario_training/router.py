"""`/api/scenario/**` —— 情境训练实验接口（学生侧 + 管理侧）。

- **默认关闭**（`SCENARIO_TRAINING_ENABLED`）：关闭时整个命名空间 404。
- 学生侧判 `scenario_training`；管理侧内容用 `case_manage`、数据用 `stats_view`。
- 会话只能被本人读取与操作；管理侧可读全部会话（含每回合的**解析/结算/交付**来源与拒绝原因）。
- **路由只做输入输出适配**：解析、结算、演出、提交全在 `runtime/session.py`；HTTP 与 SSE
  共用同一个执行器（docs/23 §8.3）。

**内容只有一份**：`st_packs.content` 是当前内容、`version` 是保存次数；会话在开局时把内容
**快照进自己的行**，此后病例怎么改都不影响这一局（回放、判读都读快照）。所以这里没有修订、
没有归档、没有"只读旧局"——一个会话要么在进行、要么已结束。

学生侧错误一律是 `{"code", "message"}`（冲突另带 `current_seq`）——**不带** problems、字段路径或堆栈。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from core.config import SCENARIO_TRAINING_ENABLED
from core.deps import CurrentUser, DbSession
from core.rate_limits import check_scenario_action_limit, check_scenario_open_limit
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import User
from models.scenario_training import StAsset, StEvent, StPack, StSession

from . import assets as assets_mod
from . import pack_loader
from .api_models import (
    ScenarioAdminActor,
    ScenarioAdminAsset,
    ScenarioAdminAssetUpload,
    ScenarioAdminEvent,
    ScenarioAdminFocusSummary,
    ScenarioAdminFocusTurn,
    ScenarioAdminOverview,
    ScenarioAdminPack,
    ScenarioAdminPackDelete,
    ScenarioAdminPackUpload,
    ScenarioAdminSessionDetail,
    ScenarioAdminSessionList,
    ScenarioAdminSessionRow,
    ScenarioAdminStats,
    ScenarioAdminStatsBucket,
    ScenarioAdminTurnReplay,
    ScenarioCloseRequest,
    ScenarioCloseResponse,
    ScenarioErrorInfo,
    ScenarioNewPackRequest,
    ScenarioOpenSessionRequest,
    ScenarioPackContent,
    ScenarioPackContentRequest,
    ScenarioPackProblem,
    ScenarioPackSummary,
    ScenarioPackValidation,
    ScenarioReport,
    ScenarioRequestLookup,
    ScenarioSessionResponse,
    ScenarioSessionRow,
    ScenarioSessionState,
    ScenarioSseCommitted,
    ScenarioSseEnvelope,
    ScenarioSseError,
    ScenarioSsePhase,
    ScenarioTurnRequest,
    ScenarioTurnResult,
    ScenarioView,
)
from .dm.stages import StageFailure
from .pack_loader import PackInvalid
from .runtime.replay import admin_turns, focus_turns
from .runtime.session import (
    RequestConflict,
    SeqConflict,
    SessionClosed,
    TurnHooks,
    create_session,
    load_events,
    replay,
    request_lookup,
    session_row,
    session_turns,
    submit_close,
    submit_turn,
)
from .runtime.view import build_view
from .runtime.world import TurnRejected
from .schema import Asset, ScenarioPack
from .turns import TurnPhase
from .validation import validate_pack

_ContentManager = Depends(require_permission("case_manage"))
_DataViewer = Depends(require_permission("stats_view"))
_StudentUser = Annotated[User, Depends(require_permission("scenario_training"))]

log = logging.getLogger(__name__)

_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
_CACHE_REPLACEABLE = "private, max-age=300"


def require_enabled() -> None:
    """实验特性开关：关闭时一律 404（不是 403，避免暴露实验面）。"""
    if not SCENARIO_TRAINING_ENABLED:
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(
    prefix="/api/scenario",
    tags=["情境训练"],
    dependencies=[Depends(require_enabled)],
)


# --------------------------------------------------------------------------- #
# 错误映射（学生侧口径；管理侧另有自己的 422 形状）
# --------------------------------------------------------------------------- #


def _student_error(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def _map_error(exc: Exception) -> HTTPException:
    if isinstance(exc, SessionClosed):
        return _student_error(409, "session_closed", "这次情境已经结束")
    if isinstance(exc, SeqConflict):
        return _student_error(409, "session_conflict", "世界已经往前走了，请刷新后重试", current_seq=exc.current_seq)
    if isinstance(exc, RequestConflict):
        return _student_error(409, "request_conflict", "这个请求号已经用于另一次输入")
    if isinstance(exc, TurnRejected):
        return _student_error(422, exc.code, exc.message)
    if isinstance(exc, StageFailure):
        status = 503 if exc.code == "provider_unavailable" else 502
        message = "模型暂时不可用，本次未执行、世界未改变" if status == 503 else "本次没有生成成功，世界未改变"
        return _student_error(status, exc.code, message)
    return _student_error(500, "internal_error", "服务端异常，本次未提交")


def _pack_of(session: StSession) -> ScenarioPack:
    """会话自带的**内容快照** → 已校验的病例（回放/判读/继续都读它，不读今天的病例内容）。"""
    return pack_loader.pack_from_content(session.pack_content or {})


def _live_view(db: DbSession, session: StSession, pack: ScenarioPack) -> ScenarioView:
    from .judge.rules import dims_snapshot

    world = replay(db, session.id, pack)
    return build_view(
        pack,
        world,
        session_id=session.id,
        status=session.status,
        pack_key=session.pack_key,
        version=session.pack_version,
        dims=dims_snapshot(pack, world),
        trial=bool((session.meta or {}).get("trial")),
    )


def _require_pack(db: DbSession, pack_key: str) -> StPack:
    row = pack_loader.get_pack(db, pack_key)
    if row is None:
        raise HTTPException(status_code=404, detail=f"情境包不存在：{pack_key}")
    return row


def _require_published(db: DbSession, pack_key: str) -> StPack:
    """学生**开新局**的门：病例必须已上架（下架不删数据，老会话照常继续）。

    找不到这个病例按不存在处理（不泄漏"有个未上架的病例"）。
    """
    row = pack_loader.get_pack(db, pack_key)
    if row is None or not row.published:
        raise HTTPException(
            status_code=409,
            detail={"code": "pack_unpublished", "message": "这个情境还没有上架，暂时不能开始"},
        )
    return row


def _load_session(db: DbSession, session_id: int, user_id: int | None) -> StSession:
    session = db.execute(select(StSession).where(StSession.id == session_id)).scalar_one_or_none()
    if session is None or (user_id is not None and session.user_id != user_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return session


def _stored_report(raw: Any) -> ScenarioReport | None:
    """库里存下的结算报告（结束时的原样留档；学生再打开看到的还是它）。"""
    if not isinstance(raw, dict):
        return None
    try:
        return ScenarioReport.model_validate(raw)
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# 学生侧
# --------------------------------------------------------------------------- #


@router.get("/packs")
def list_packs(db: DbSession, current_user: _StudentUser) -> list[ScenarioPackSummary]:
    """可用情境包（**只列已上架**，含当前内容版本）。"""
    return [ScenarioPackSummary.model_validate(item) for item in pack_loader.list_packs(db, published_only=True)]


@router.post("/sessions")
async def create_session_route(
    payload: ScenarioOpenSessionRequest,
    request: Request,
    db: DbSession,
    current_user: _StudentUser,
) -> ScenarioSessionResponse:
    """开启一次情境：DM **先立场景**（开场回合），再等学生动手。

    用病例的**当前内容**开局，并把它快照进这一局（`trial=true` 的试跑额外要求 `case_manage`，
    可以开还没上架的草稿，并显式标记该会话从统计默认排除）。
    """
    await check_scenario_open_limit(current_user.id, request)
    if payload.trial and not current_user.has_permission("case_manage"):
        raise HTTPException(status_code=403, detail="权限不足")
    if payload.pack_key is None:
        available = pack_loader.list_packs(db, published_only=True)
        if not available:
            raise HTTPException(status_code=404, detail="尚无可用情境包")
        key = str(available[0]["key"])
    else:
        key = payload.pack_key
    # 试跑：草稿也能开（作者要能试）；学生开新局必须已上架
    row = _require_pack(db, key) if payload.trial else _require_published(db, key)
    _, pack = pack_loader.load_pack(db, row.key)
    session, _problems = await create_session(
        db,
        user_id=current_user.id,
        pack_key=row.key,
        pack_version=row.version,
        content=row.content,
        pack=pack,
        llm=request.app.state.llm_client,
        trial=payload.trial,
    )
    view = _live_view(db, session, pack)
    return ScenarioSessionResponse(session_id=session.id, pack=view.pack, view=view)


@router.get("/sessions")
def my_sessions(
    db: DbSession,
    current_user: _StudentUser,
    limit: int = Query(default=30, ge=1, le=200),
) -> list[ScenarioSessionRow]:
    """我的情境历史（学生侧）。"""
    rows = (
        db.execute(
            select(StSession).where(StSession.user_id == current_user.id).order_by(StSession.id.desc()).limit(limit)
        )
        .scalars()
        .all()
    )
    titles = _titles_of(db)
    turns = session_turns(db, [row.id for row in rows])
    return [
        ScenarioSessionRow.model_validate(session_row(row, titles.get(row.pack_key, row.pack_key), turns[row.id]))
        for row in rows
    ]


@router.get("/sessions/{session_id}")
def get_session(session_id: int, db: DbSession, current_user: _StudentUser) -> ScenarioSessionState:
    """会话当前状态（视图按**会话自带的内容快照**回放）。"""
    session = _load_session(db, session_id, current_user.id)
    pack = _pack_of(session)
    return ScenarioSessionState(
        session_id=session.id,
        status=session.status,
        report=_stored_report(session.report),
        view=_live_view(db, session, pack),
    )


@router.post("/sessions/{session_id}/turns")
async def submit_turn_route(
    session_id: int,
    payload: ScenarioTurnRequest,
    request: Request,
    db: DbSession,
    current_user: _StudentUser,
) -> ScenarioTurnResult:
    """学生做一件事 → 世界回应 → 返回权威视图（**解析 → 结算 → 演出 → 原子提交**）。"""
    await check_scenario_action_limit(current_user.id, request)
    session = _load_session(db, session_id, current_user.id)
    pack = _pack_of(session)
    try:
        return await submit_turn(
            db,
            session=session,
            pack=pack,
            request=payload,
            llm=request.app.state.llm_client,
            user_id=current_user.id,
        )
    except (SessionClosed, SeqConflict, RequestConflict, TurnRejected, StageFailure) as exc:
        raise _map_error(exc) from exc


def _sse(event: str, payload: Any) -> str:
    body = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload
    return f"event: {event}\ndata: {json.dumps(body, ensure_ascii=False)}\n\n"


@router.post(
    "/sessions/{session_id}/turns/stream",
    # SSE 的三种事件载荷**也是生成类型**：用联合类型声明响应模型，
    # FastAPI 才会把 `ScenarioSsePhase/Delivery/Committed/Error` 放进 components.schemas
    # （运行期返回的是 StreamingResponse，不走这里的序列化）。
    response_model=ScenarioSseEnvelope,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def submit_turn_stream(
    session_id: int,
    payload: ScenarioTurnRequest,
    request: Request,
    db: DbSession,
    current_user: _StudentUser,
) -> StreamingResponse:
    """同一回合的 SSE 传输：`phase` / `committed` / `error`。

    与 JSON 路径共用 `submit_turn`；这里只把阶段推出去。
    """
    await check_scenario_action_limit(current_user.id, request)
    session = _load_session(db, session_id, current_user.id)
    pack = _pack_of(session)
    llm = request.app.state.llm_client
    user_id = current_user.id

    async def event_stream() -> AsyncIterator[str]:
        """**真流式**：阶段与待提交交付随发生即刻到达，不等回合结束一次性喷出。"""
        queue: asyncio.Queue[str] = asyncio.Queue()
        last_phase: dict[str, TurnPhase] = {"value": "receiving"}

        async def on_phase(name: TurnPhase) -> None:
            last_phase["value"] = name
            queue.put_nowait(_sse("phase", ScenarioSsePhase(request_id=payload.request_id, phase=name)))

        async def run() -> ScenarioTurnResult:
            return await submit_turn(
                db,
                session=session,
                pack=pack,
                request=payload,
                llm=llm,
                user_id=user_id,
                hooks=TurnHooks(on_phase=on_phase),
            )

        yield _sse("phase", ScenarioSsePhase(request_id=payload.request_id, phase="receiving"))
        task = asyncio.create_task(run())
        while True:
            getter: asyncio.Task = asyncio.create_task(queue.get())
            done, _pending = await asyncio.wait({getter, task}, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                yield getter.result()
                continue
            getter.cancel()
            await asyncio.gather(getter, return_exceptions=True)
            while not queue.empty():
                yield queue.get_nowait()
            break

        exc = task.exception()
        if exc is not None:
            if isinstance(exc, (SessionClosed, SeqConflict, RequestConflict, TurnRejected, StageFailure)):
                http = _map_error(exc)
                detail: dict[str, Any] = (
                    http.detail
                    if isinstance(http.detail, dict)
                    else {"code": "internal_error", "message": str(http.detail)}
                )
                error = ScenarioErrorInfo(
                    code=str(detail.get("code") or "internal_error"),
                    message=str(detail.get("message") or ""),
                    retryable=http.status_code >= 502,
                    current_seq=detail.get("current_seq"),
                )
            else:
                log.exception("scenario stream failed: %s", exc)
                error = ScenarioErrorInfo(code="internal_error", message="服务端异常，本次未提交", retryable=False)
            yield _sse(
                "error",
                ScenarioSseError(request_id=payload.request_id, phase=last_phase["value"], error=error),
            )
            return
        result = task.result()
        yield _sse("committed", ScenarioSseCommitted(request_id=payload.request_id, seq=result.seq, result=result))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/sessions/{session_id}/requests/{request_id}")
def lookup_request(
    session_id: int, request_id: str, db: DbSession, current_user: _StudentUser
) -> ScenarioRequestLookup:
    """按 `request_id` 取回原结果（断流恢复；`unknown` = 没有已提交记录、结果未明）。"""
    _load_session(db, session_id, current_user.id)
    return request_lookup(db, session_id=session_id, request_id=request_id)


@router.post("/sessions/{session_id}/close")
def close_session_route(
    session_id: int,
    payload: ScenarioCloseRequest,
    db: DbSession,
    current_user: _StudentUser,
) -> ScenarioCloseResponse:
    """结束并结算判读（规则可复算；不启用能力等第）。"""
    session = _load_session(db, session_id, current_user.id)
    pack = _pack_of(session)
    try:
        return submit_close(
            db,
            session=session,
            pack=pack,
            request_id=payload.request_id,
            expected_seq=payload.expected_seq,
        )
    except (SessionClosed, SeqConflict, RequestConflict) as exc:
        raise _map_error(exc) from exc


@router.get("/assets/{pack_key}/{asset_id}")
def get_asset(pack_key: str, asset_id: str, db: DbSession, current_user: _StudentUser) -> Response:
    """提供场景资源（pack 声明的图片）。需要登录态。"""
    _, pack = pack_loader.load_pack(db, pack_key)
    try:
        content, mime = assets_mod.read_image(db, pack, asset_id)
    except assets_mod.AssetNotFound as exc:
        raise HTTPException(status_code=404, detail="资源不存在") from exc
    headers = {"Cache-Control": _CACHE_REPLACEABLE}
    return Response(content=content, media_type=mime, headers=headers)


# --------------------------------------------------------------------------- #
# 管理侧：内容（case_manage）
# --------------------------------------------------------------------------- #


def _pack_overview(pack: ScenarioPack | None) -> ScenarioAdminOverview | None:
    """管理侧总览：这份病例**声明了什么**（`truth` / `knowledge` 等 DM 侧边界一个都不外露）。"""
    if pack is None:
        return None
    return ScenarioAdminOverview(
        player_role=pack.player.role,
        place=pack.setting.place,
        time_hint=pack.setting.time_hint,
        resources=list(pack.setting.resources),
        actors=[
            ScenarioAdminActor(id=actor.id, role=actor.role, presence=actor.presence.value) for actor in pack.actors
        ],
        teaching_focus=[ScenarioAdminFocusSummary(id=item.id, intent=item.intent) for item in pack.teaching_focus],
        cues=len(pack.setting.cues),
        affordances=len(pack.affordances),
        reactions=len(pack.reactions),
        facts=len(pack.facts),
        criteria=len(pack.rubric),
        criteria_weight=sum(item.weight for item in pack.rubric),
        failure=pack.failure,
    )


def _stamp(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _current_pack(row: StPack) -> ScenarioPack | None:
    """病例的当前内容（装进来的内容必然已校验；库若是被外部改坏，列表不因此整页 500）。"""
    try:
        return pack_loader.pack_from_content(row.content or {})
    except (PackInvalid, ValueError):
        return None


def _titles_of(db: DbSession) -> dict[str, str]:
    """`pack_key → 病例标题`（一次查询；标题在内容里，所以读 `content`）。"""
    return {
        str(key): pack_loader.content_meta(content or {})["title"]
        for key, content in db.execute(select(StPack.key, StPack.content)).all()
    }


def _admin_pack_item(db: DbSession, pack_row: StPack, *, sessions: int) -> ScenarioAdminPack:
    """一个病例的管理侧投影（列表与上架/下架/删除的响应共用一份）。"""
    pack = _current_pack(pack_row)
    meta = pack_loader.content_meta(pack_row.content or {})
    return ScenarioAdminPack(
        key=pack_row.key,
        title=meta["title"],
        one_line=meta["one_line"],
        version=int(pack_row.version),
        published=bool(pack_row.published),
        published_at=_stamp(pack_row.published_at),
        assets=[ScenarioAdminAsset.model_validate(item) for item in (assets_mod.describe(db, pack) if pack else [])],
        overview=_pack_overview(pack),
        sessions=sessions,
    )


@router.get("/admin/packs", dependencies=[_DataViewer])
def admin_packs(db: DbSession) -> list[ScenarioAdminPack]:
    """管理侧：全部情境包（含上架状态、当前内容版本、资源状态、关注点概览、会话数）。"""
    packs = db.execute(select(StPack).order_by(StPack.key)).scalars().all()
    counts = {
        str(key): int(total)
        for key, total in db.execute(
            select(StSession.pack_key, func.count(StSession.id)).group_by(StSession.pack_key)
        ).all()
    }
    return [_admin_pack_item(db, pack_row, sessions=int(counts.get(pack_row.key, 0))) for pack_row in packs]


def _session_count(db: DbSession, pack_key: str) -> int:
    return int(db.query(func.count(StSession.id)).filter(StSession.pack_key == pack_key).scalar() or 0)


def _install_pack(
    db: DbSession,
    pack: ScenarioPack,
    *,
    created_by: int | None = None,
    published: bool = True,
) -> tuple[StPack, bool]:
    """装/重装一份包（**内容只有一份**：同内容幂等、内容变了 version +1）。校验失败一律变成可读的 422。

    `published` 只在**新建病例行**时生效：播种 / 上传一份 JSON → 直接上架（本来就是给人用的内容）；
    系统侧「新建空白 / 复制」传 `False`，作者显式上架。
    """
    try:
        return pack_loader.install(db, pack, created_by=created_by, published=published)
    except PackInvalid as exc:
        raise HTTPException(status_code=422, detail={"message": "包未通过校验", "problems": exc.problems}) from exc
    except assets_mod.AssetRejected as exc:
        raise HTTPException(status_code=422, detail={"message": "包内资源无法入库", "problems": [str(exc)]}) from exc


@router.post("/admin/packs", dependencies=[_ContentManager])
async def admin_upload_pack(
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> ScenarioAdminPackUpload:
    """管理侧：上传（或覆盖）一份情境包 JSON → 成为当前内容（默认上架）。"""
    raw = await file.read()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail=f"不是合法的 JSON：{exc}") from exc
    try:
        pack = ScenarioPack.model_validate(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"包结构不合法：{str(exc)[:300]}") from exc

    with unit_of_work(db, conflict_detail="上传情境包失败"):
        row, changed = _install_pack(db, pack, created_by=current_user.id)
        assets_pending = assets_mod.seed_from_pack(db, pack)
    return ScenarioAdminPackUpload(
        key=pack.key,
        version=int(row.version),
        created=changed,
        assets_pending=list(assets_pending),
    )


def _validation_of(db: DbSession, pack_key: str, content: dict[str, Any]) -> ScenarioPackValidation:
    """用**同一套**加载期校验算校验结果与"这次保存会不会让 version +1"。"""
    problems = pack_loader.validate_content(content)
    sha: str | None = None
    if not problems:
        sha = pack_loader.content_sha(ScenarioPack.model_validate(content).model_dump(mode="json"))
    row = _require_pack(db, pack_key)
    latest_sha = pack_loader.content_sha(row.content or {})
    return ScenarioPackValidation(
        ok=not problems,
        problems=[ScenarioPackProblem.model_validate(item) for item in problems],
        content_sha=sha,
        latest_sha=latest_sha,
        will_change=sha is not None and sha != latest_sha,
        version=int(row.version),
    )


@router.get("/admin/packs/{pack_key}/content", dependencies=[_ContentManager])
def admin_pack_content(pack_key: str, db: DbSession) -> ScenarioPackContent:
    """编辑器：读这份病例的**当前内容**（存回去就走 POST 同一个端点）。"""
    row = _require_pack(db, pack_key)
    content = row.content or {}
    problems = pack_loader.validate_content(content)
    meta = pack_loader.content_meta(content)
    return ScenarioPackContent(
        key=row.key,
        title=meta["title"],
        one_line=meta["one_line"],
        version=int(row.version),
        published=bool(row.published),
        published_at=_stamp(row.published_at),
        content=content,
        problems=[ScenarioPackProblem.model_validate(item) for item in problems],
    )


@router.post("/admin/packs/{pack_key}/content", dependencies=[_ContentManager])
def admin_save_pack_content(
    pack_key: str,
    payload: ScenarioPackContentRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> ScenarioPackContent:
    """编辑器保存：**覆盖当前内容**（内容未变则幂等，不涨 version）。"""
    content = payload.content
    problems = pack_loader.validate_content(content)
    if problems:
        raise HTTPException(status_code=422, detail={"message": "包未通过校验", "problems": problems})
    pack = ScenarioPack.model_validate(content)
    if pack.key != pack_key:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "包内容与病例不一致",
                "problems": [{"path": "key", "message": f"内容里的 key 是 {pack.key}"}],
            },
        )
    with unit_of_work(db, conflict_detail="保存情境包失败"):
        row, changed = _install_pack(db, pack, created_by=current_user.id)
        assets_mod.seed_from_pack(db, pack)
    meta = pack_loader.content_meta(row.content or {})
    return ScenarioPackContent(
        key=row.key,
        title=meta["title"],
        one_line=meta["one_line"],
        version=int(row.version),
        published=bool(row.published),
        published_at=_stamp(row.published_at),
        content=row.content or {},
        changed=changed,
    )


@router.post("/admin/packs/{pack_key}/validate", dependencies=[_ContentManager])
def admin_validate_pack(pack_key: str, payload: ScenarioPackContentRequest, db: DbSession) -> ScenarioPackValidation:
    """编辑器：保存前校验（不落库）。失败时每条问题都带字段路径。"""
    return _validation_of(db, pack_key, payload.content)


# --------------------------------------------------------------------------- #
# 病例管理：新建 / 复制 / 上架 / 下架 / 删除（作者在系统侧完成，不依赖仓库文件）
# --------------------------------------------------------------------------- #

#: 「新建空白病例」的骨架：**最小可运行**（一个人物 + 一个动作 + 一条线索），直接能试跑，
#: 作者拿到的是可以立刻改的东西，而不是空对象。
_BLANK_PACK: dict[str, Any] = {
    "key": "new-case",
    "title": "新病例",
    "one_line": "一句话说明这是什么处境（改我）",
    "player": {"role": "责任护士"},
    "setting": {
        "place": "病房",
        "time_hint": "",
        "resources": [],
        "cues": [{"id": "c_first", "text": "（写下学生一进来就看得见的东西）", "visible_from_start": True}],
    },
    "actors": [{"id": "patient", "role": "患者", "presence": "on_site"}],
    "state_keys": {},
    "affordances": [
        {
            "id": "ask_open",
            "type": "ask",
            "label": "问一句（改我）",
            "reveals": ["c_first"],
            "targets": [{"kind": "actor", "id": "patient"}],
        }
    ],
    "reactions": [],
    "facts": [],
    "dims": [],
    "rubric": [],
    "presentation": {"hud": [], "panels": [], "board": [], "devices": []},
    "failure": "recoverable",
    "hidden_from_player": [],
}


def _missing_minimum(content: dict[str, Any]) -> list[dict[str, str]]:
    """上架前的**最小内容要求**（在加载期校验之外单列一项：作者要看到"还缺什么"）。"""
    out: list[dict[str, str]] = []
    if not str((content.get("player") or {}).get("role") or "").strip():
        out.append({"path": "player.role", "message": "缺「你扮演谁」"})
    if not str((content.get("setting") or {}).get("place") or "").strip():
        out.append({"path": "setting.place", "message": "缺「在哪儿」"})
    if not content.get("actors"):
        out.append({"path": "actors", "message": "至少要有一个人物"})
    if not content.get("affordances"):
        out.append({"path": "affordances", "message": "至少要有一个可执行的动作"})
    return out


def _require_free_key(db: DbSession, key: str) -> None:
    if pack_loader.get_pack(db, key) is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "pack_key_exists", "message": f"病例 key「{key}」已被占用，请换一个"},
        )


def _install_new_pack(
    db: DbSession, content: dict[str, Any], *, created_by: int
) -> tuple[ScenarioAdminPackUpload, list[str]]:
    problems = pack_loader.validate_content(content)
    if problems:
        raise HTTPException(status_code=422, detail={"message": "内容未通过校验", "problems": problems})
    pack = ScenarioPack.model_validate(content)
    with unit_of_work(db, conflict_detail="新建病例失败"):
        row, changed = _install_pack(db, pack, created_by=created_by, published=False)
        pending = assets_mod.seed_from_pack(db, pack)
    return (
        ScenarioAdminPackUpload(
            key=pack.key,
            version=int(row.version),
            created=changed,
            assets_pending=list(pending),
        ),
        list(pending),
    )


@router.post("/admin/packs/blank", dependencies=[_ContentManager])
def admin_new_blank_pack(
    payload: ScenarioNewPackRequest, db: DbSession, current_user: CurrentUser
) -> ScenarioAdminPackUpload:
    """**新建空白病例**：给一个最小可运行骨架（人物 + 动作 + 线索，可直接试跑）。"""
    _require_free_key(db, payload.key)
    content = {**_BLANK_PACK, "key": payload.key, "title": payload.title}
    upload, _pending = _install_new_pack(db, content, created_by=current_user.id)
    return upload


@router.post("/admin/packs/{pack_key}/duplicate", dependencies=[_ContentManager])
def admin_duplicate_pack(
    pack_key: str, payload: ScenarioNewPackRequest, db: DbSession, current_user: CurrentUser
) -> ScenarioAdminPackUpload:
    """**复制这个病例**（做变式）：以源病例**当前内容**为内容，指向新 key。"""
    source = _require_pack(db, pack_key)
    _require_free_key(db, payload.key)
    content = {**(source.content or {}), "key": payload.key, "title": payload.title}
    upload, _pending = _install_new_pack(db, content, created_by=current_user.id)
    return upload


def _publish_gate(db: DbSession, row: StPack) -> None:
    """上架前的检查：当前内容通过校验 + 满足最小内容要求。"""
    content = row.content or {}
    problems = pack_loader.validate_content(content) or _missing_minimum(content)
    if problems:
        raise HTTPException(status_code=422, detail={"message": "病例未通过校验，不能上架", "problems": problems})


@router.post("/admin/packs/{pack_key}/publish", dependencies=[_ContentManager])
def admin_publish_pack(pack_key: str, db: DbSession) -> ScenarioAdminPack:
    """**上架**：学生列表可见、可开新局。校验不过不许上架（错误带字段路径）。幂等。"""
    row = _require_pack(db, pack_key)
    _publish_gate(db, row)
    if not row.published:
        with unit_of_work(db, conflict_detail="上架病例失败"):
            row.published = True
            row.published_at = datetime.now(UTC)
    return _admin_pack_item(db, row, sessions=_session_count(db, pack_key))


@router.post("/admin/packs/{pack_key}/unpublish", dependencies=[_ContentManager])
def admin_unpublish_pack(pack_key: str, db: DbSession) -> ScenarioAdminPack:
    """**下架**：不再出现在学生列表、不能再开新局；**数据不动**，已进行的会话照常继续。幂等。"""
    row = _require_pack(db, pack_key)
    if row.published:
        with unit_of_work(db, conflict_detail="下架病例失败"):
            row.published = False
    return _admin_pack_item(db, row, sessions=_session_count(db, pack_key))


@router.delete("/admin/packs/{pack_key}", dependencies=[_ContentManager])
def admin_delete_pack(pack_key: str, db: DbSession, confirm: bool = Query(default=False)) -> ScenarioAdminPackDelete:
    """**删除**病例（当前内容 + 图片字节）。只在**该病例没有任何会话**时允许。

    每一局都自带内容快照，删了病例老会话仍回放得出来 —— 但病例是这些会话的归属，
    有记录时明确拒绝并告诉作者"可下架但不可删除"；`confirm=true` 是防手滑的服务端那一半（弹窗在前端）。
    """
    row = _require_pack(db, pack_key)
    if not confirm:
        raise HTTPException(
            status_code=400, detail={"code": "confirm_required", "message": "删除需要确认（confirm=true）"}
        )
    sessions = _session_count(db, pack_key)
    if sessions:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "pack_has_sessions",
                "message": f"这个病例已有 {sessions} 局记录，可下架但不可删除",
                "sessions": sessions,
            },
        )
    asset_ids = [
        str(item.asset_id) for item in db.execute(select(StAsset).where(StAsset.pack_key == pack_key)).scalars().all()
    ]
    with unit_of_work(db, conflict_detail="删除病例失败"):
        for asset_id in asset_ids:
            assets_mod.delete_asset(db, pack_key, asset_id)
        db.delete(row)
    return ScenarioAdminPackDelete(key=pack_key, deleted_assets=len(asset_ids))


@router.post("/admin/packs/{pack_key}/assets/{asset_id}", dependencies=[_ContentManager])
async def admin_replace_asset(
    pack_key: str,
    asset_id: str,
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    title: str = Form(default=""),
    alt: str = Form(default=""),
) -> ScenarioAdminAssetUpload:
    """**替换**一张场景图片：`asset_id` 不变（编辑器里的 JSON 引用不用改），只换字节与文案。

    声明变了就重新保存一次内容（version +1；声明没变则幂等）。
    """
    row, pack = pack_loader.load_pack(db, pack_key)
    existing = next((item for item in pack.assets if item.id == asset_id), None)
    if existing is None:
        raise HTTPException(status_code=404, detail="该包未声明此资源（新增请走上传接口）")
    data = await file.read()
    mime = file.content_type or _MEDIA_TYPES.get(
        "." + (file.filename or "").rsplit(".", 1)[-1].lower(), "application/octet-stream"
    )
    declaration = existing.model_copy(
        update={
            "title": title or existing.title,
            "alt": alt or existing.alt,
        }
    )
    updated = pack.model_copy(update={"assets": [*(item for item in pack.assets if item.id != asset_id), declaration]})
    problems = validate_pack(updated)
    if problems:
        raise HTTPException(status_code=422, detail={"message": "资源声明未通过校验", "problems": problems})
    with unit_of_work(db, conflict_detail="替换资源失败"):
        try:
            assets_mod.store_asset(
                db,
                pack_key=pack_key,
                asset_id=asset_id,
                filename=file.filename or f"{asset_id}.png",
                mime_type=mime,
                data=data,
            )
        except assets_mod.AssetRejected as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _install_pack(db, updated, created_by=current_user.id)
    asset = next(item for item in assets_mod.describe(db, updated) if item["id"] == asset_id)
    return ScenarioAdminAssetUpload(key=pack_key, asset=ScenarioAdminAsset.model_validate(asset))


@router.get("/admin/packs/{pack_key}/assets/{asset_id}", dependencies=[_DataViewer])
def admin_get_asset(pack_key: str, asset_id: str, db: DbSession) -> Response:
    """管理侧预览：按 pack key 取资源字节。"""
    _, pack = pack_loader.load_pack(db, pack_key)
    try:
        content, mime = assets_mod.read_image(db, pack, asset_id)
    except assets_mod.AssetNotFound as exc:
        raise HTTPException(status_code=404, detail="资源不存在") from exc
    headers = {"Cache-Control": _CACHE_REPLACEABLE}
    return Response(content=content, media_type=mime, headers=headers)


@router.post("/admin/packs/{pack_key}/assets", dependencies=[_ContentManager])
async def admin_upload_asset(
    pack_key: str,
    db: DbSession,
    current_user: CurrentUser,
    asset_id: str = Form(..., min_length=1, max_length=64),
    file: UploadFile = File(...),
    title: str = Form(default=""),
    alt: str = Form(default=""),
) -> ScenarioAdminAssetUpload:
    """管理侧：上传一张场景图片 → 存字节 + 把声明写进当前内容。"""
    row, pack = pack_loader.load_pack(db, pack_key)
    del row
    data = await file.read()
    mime = file.content_type or _MEDIA_TYPES.get(
        "." + (file.filename or "").rsplit(".", 1)[-1].lower(), "application/octet-stream"
    )
    declaration = Asset(
        id=asset_id,
        kind="image",
        path="",
        title=title or asset_id,
        alt=alt or title or asset_id,
    )
    updated = pack.model_copy(update={"assets": [*(item for item in pack.assets if item.id != asset_id), declaration]})
    problems = validate_pack(updated)
    if problems:
        raise HTTPException(status_code=422, detail={"message": "资源声明未通过校验", "problems": problems})
    with unit_of_work(db, conflict_detail="上传资源失败"):
        try:
            assets_mod.store_asset(
                db,
                pack_key=pack_key,
                asset_id=asset_id,
                filename=file.filename or f"{asset_id}.png",
                mime_type=mime,
                data=data,
            )
        except assets_mod.AssetRejected as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _install_pack(db, updated, created_by=current_user.id)
    asset = next(item for item in assets_mod.describe(db, updated) if item["id"] == asset_id)
    return ScenarioAdminAssetUpload(key=pack_key, asset=ScenarioAdminAsset.model_validate(asset))


@router.delete("/admin/packs/{pack_key}/assets/{asset_id}", dependencies=[_ContentManager])
def admin_delete_asset(pack_key: str, asset_id: str, db: DbSession) -> dict[str, Any]:
    """管理侧：撤下一张资源（声明从当前内容里去掉，字节一并删除）。"""
    row, pack = pack_loader.load_pack(db, pack_key)
    if asset_id not in assets_mod.declared_ids(pack):
        raise HTTPException(status_code=404, detail="该包未声明此资源")
    updated = pack.model_copy(update={"assets": [item for item in pack.assets if item.id != asset_id]})
    with unit_of_work(db, conflict_detail="移除资源失败"):
        row, _changed = _install_pack(db, updated)
        assets_mod.delete_asset(db, pack_key, asset_id)
    return {"key": pack_key, "version": int(row.version), "assets": assets_mod.describe(db, updated)}


# --------------------------------------------------------------------------- #
# 管理侧：数据（stats_view）
# --------------------------------------------------------------------------- #


@router.get("/admin/sessions", dependencies=[_DataViewer])
def admin_sessions(
    db: DbSession,
    pack_key: str | None = None,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ScenarioAdminSessionList:
    """管理侧：会话列表（可按包/状态过滤）。"""
    query = select(StSession)
    if pack_key:
        query = query.where(StSession.pack_key == pack_key)
    if status:
        query = query.where(StSession.status == status)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = db.execute(query.order_by(StSession.id.desc()).limit(limit).offset(offset)).scalars().all()
    titles = _titles_of(db)
    turns = session_turns(db, [row.id for row in rows])
    return ScenarioAdminSessionList(
        total=int(total),
        items=[
            ScenarioAdminSessionRow.model_validate(
                session_row(row, titles.get(row.pack_key, row.pack_key), turns[row.id])
            )
            for row in rows
        ],
    )


@router.get("/admin/sessions/{session_id}", dependencies=[_DataViewer])
def admin_session_detail(session_id: int, db: DbSession) -> ScenarioAdminSessionDetail:
    """管理侧：单次会话的完整回放（视图 + 报告 + 每回合解析/结算/交付 + 关注点投影）。

    视图按**这一局自带的内容快照**回放：病例今天被改成什么样都不影响历史回放。
    """
    session = _load_session(db, session_id, None)
    pack = _pack_of(session)
    events = load_events(db, session.id)
    problems = [str(item) for event in events for item in ((event.get("payload") or {}).get("problems") or [])]
    view = _live_view(db, session, pack)
    report = _stored_report(session.report)
    return ScenarioAdminSessionDetail(
        session=ScenarioAdminSessionRow.model_validate(
            session_row(session, pack.title, session_turns(db, [session.id])[session.id])
        ),
        view=view,
        report=report,
        problems=problems,
        focus=[
            ScenarioAdminFocusTurn.model_validate(item.model_dump(mode="json")) for item in focus_turns(pack, events)
        ],
        turns=[ScenarioAdminTurnReplay.model_validate(item.model_dump(mode="json")) for item in admin_turns(events)],
        event_count=len(events),
        events=[
            ScenarioAdminEvent(kind=str(event["kind"]), payload=event.get("payload") or {})
            for event in events
            if event["kind"]
        ],
    )


@router.get("/admin/stats", dependencies=[_DataViewer])
def admin_stats(db: DbSession) -> ScenarioAdminStats:
    """管理侧：按包汇总（会话数、结算数、不可逆结局数、关注点处理比例）。试跑默认排除。"""
    rows = db.execute(
        select(StSession.id, StSession.pack_key, StSession.status, StSession.report, StSession.meta)
    ).all()
    titles = _titles_of(db)
    # 关注点的已处理/相关计数取自 `session_closed` 载荷（报告是学生可见的，里面没有关注点）
    focus_counts = {
        int(sid): (int(rel or 0), int(add or 0))
        for sid, rel, add in db.execute(
            select(
                StEvent.session_id,
                StEvent.payload["focus_relevant"].as_integer(),
                StEvent.payload["focus_addressed"].as_integer(),
            ).where(StEvent.kind == "session_closed")
        ).all()
    }
    stats: dict[str, dict[str, Any]] = {}
    for session_id, pack_key, status, report, meta in rows:
        if (meta or {}).get("trial"):
            continue
        bucket = stats.setdefault(
            pack_key,
            {
                "pack_key": pack_key,
                "pack_title": titles.get(pack_key, pack_key),
                "sessions": 0,
                "completed": 0,
                "lost": 0,
                "addressed": 0,
                "relevant": 0,
            },
        )
        bucket["sessions"] += 1
        if status == "completed":
            bucket["completed"] += 1
        payload = report or {}
        outcome = payload.get("outcome") or {}
        if outcome.get("lost") or payload.get("lost"):
            bucket["lost"] += 1
        relevant, addressed = focus_counts.get(int(session_id), (0, 0))
        bucket["relevant"] += relevant
        bucket["addressed"] += addressed
    return ScenarioAdminStats(
        packs=[
            ScenarioAdminStatsBucket(
                pack_key=item["pack_key"],
                pack_title=item["pack_title"],
                sessions=item["sessions"],
                completed=item["completed"],
                lost=item["lost"],
                focus_address_ratio=(round(item["addressed"] / item["relevant"], 4) if item["relevant"] else None),
            )
            for item in sorted(stats.values(), key=lambda entry: entry["pack_key"])
        ]
    )
