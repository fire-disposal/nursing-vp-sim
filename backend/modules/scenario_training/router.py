"""`/api/scenario/**` —— 情境训练实验接口（学生侧 + 管理侧）。

- **默认关闭**（`SCENARIO_TRAINING_ENABLED`）：关闭时整个命名空间 404。
- 学生侧判 `scenario_training`；管理侧内容用 `case_manage`、数据用 `stats_view`。
- 会话只能被本人读取与操作；管理侧可读全部会话（含每回合的**解析/结算/交付**来源与拒绝原因）。
- **路由只做输入输出适配**：解析、结算、演出、提交全在 `runtime/session.py`；HTTP 与 SSE
  共用同一个执行器（docs/23 §8.3）。

学生侧错误一律是 `{"code", "message"}`（冲突另带 `current_seq`）——**不带** problems、字段路径或堆栈。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
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
from models.scenario_training import StEvent, StPack, StPackRevision, StSession, StSessionArchive

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
    ScenarioAdminPackConvert,
    ScenarioAdminPackSource,
    ScenarioAdminPackUpload,
    ScenarioAdminRevision,
    ScenarioAdminSessionDetail,
    ScenarioAdminSessionList,
    ScenarioAdminSessionRow,
    ScenarioAdminStats,
    ScenarioAdminStatsBucket,
    ScenarioAdminTurnReplay,
    ScenarioArchiveDetail,
    ScenarioArchiveList,
    ScenarioArchiveRaw,
    ScenarioArchiveRef,
    ScenarioArchiveSummary,
    ScenarioCloseRequest,
    ScenarioCloseResponse,
    ScenarioErrorInfo,
    ScenarioGeneratedAsset,
    ScenarioGeneratedList,
    ScenarioOpenSessionRequest,
    ScenarioPackContentRequest,
    ScenarioPackConvertRequest,
    ScenarioPackPatchRequest,
    ScenarioPackProblem,
    ScenarioPackSummary,
    ScenarioPackValidation,
    ScenarioReport,
    ScenarioRequestLookup,
    ScenarioSessionResponse,
    ScenarioSessionRow,
    ScenarioSessionState,
    ScenarioSseCommitted,
    ScenarioSseDelivery,
    ScenarioSseEnvelope,
    ScenarioSseError,
    ScenarioSsePhase,
    ScenarioTurnRequest,
    ScenarioTurnResult,
    ScenarioView,
)
from .dm.stages import StageFailure
from .pack_loader import PackInvalid, PackNotFound
from .runtime.replay import admin_turns, focus_turns
from .runtime.session import (
    RequestConflict,
    SeqConflict,
    SessionArchived,
    SessionClosed,
    TurnHooks,
    create_session,
    load_events,
    replay,
    request_lookup,
    session_read_only,
    session_row,
    session_turns,
    submit_close,
    submit_turn,
)
from .runtime.view import build_view
from .runtime.world import TurnRejected
from .schema import PACK_SCHEMA_VERSION, Asset, ScenarioPack
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
_CACHE_IMMUTABLE = "private, max-age=86400"
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
    if isinstance(exc, SessionArchived):
        return _student_error(409, "session_archived", "这是机制切换前的旧局，只能回看")
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


def _load_pack(db: DbSession, revision_id: int) -> ScenarioPack:
    try:
        return pack_loader.load_revision(db, revision_id)
    except PackNotFound as exc:
        raise HTTPException(status_code=404, detail="情境包修订不存在") from exc
    except PackInvalid as exc:
        raise HTTPException(status_code=422, detail={"message": "情境包未通过校验", "problems": exc.problems}) from exc


def _latest(db: DbSession, pack_key: str) -> tuple[StPack, StPackRevision]:
    latest = pack_loader.latest_revision(db, pack_key)
    if latest is None:
        raise HTTPException(status_code=404, detail=f"情境包不存在：{pack_key}")
    return latest


def _require_pack(db: DbSession, pack_key: str) -> StPack:
    row = db.execute(select(StPack).where(StPack.key == pack_key)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail=f"情境包不存在：{pack_key}")
    return row


def _load_session(db: DbSession, session_id: int, user_id: int | None) -> StSession:
    session = db.execute(select(StSession).where(StSession.id == session_id)).scalar_one_or_none()
    if session is None or (user_id is not None and session.user_id != user_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return session


def _require_schema_current(pack: ScenarioPack) -> None:
    """新局只接受当前形状的包修订：旧形状**不靠"裁掉未知键"当兼容**（docs/23 §9.5）。"""
    if pack.pack_schema_version < PACK_SCHEMA_VERSION:
        raise _student_error(
            422,
            "schema_unsupported",
            "这份情境是旧机制修订，不能再开新局（旧会话可回看）",
        )


def _live_view(db: DbSession, session: StSession, pack: ScenarioPack) -> ScenarioView:
    from .judge.rules import dims_snapshot

    world = replay(db, session.id, pack)
    return build_view(
        pack,
        world,
        session_id=session.id,
        status=session.status,
        revision_id=session.pack_revision_id,
        dims=dims_snapshot(pack, world),
        read_only=session_read_only(session),
        trial=bool((session.meta or {}).get("trial")),
    )


def _split_report(raw: Any) -> tuple[ScenarioReport | None, dict[str, Any] | None]:
    """把库里的报告分成**新形状**与**旧机制原样留档**——旧报告绝不被改写成新形状。"""
    if not isinstance(raw, dict):
        return None, None
    if "assessment" in raw:
        try:
            return ScenarioReport.model_validate(raw), None
        except ValueError:
            return None, raw
    return None, raw


def _archive_of(db: DbSession, session_id: int) -> StSessionArchive | None:
    return db.execute(select(StSessionArchive).where(StSessionArchive.session_id == session_id)).scalar_one_or_none()


def _archive_summary(row: StSessionArchive) -> ScenarioArchiveSummary:
    return ScenarioArchiveSummary(
        session_id=row.session_id,
        pack_key=row.pack_key,
        pack_revision_id=row.pack_revision_id,
        shape_version=row.shape_version,
        archived_at=row.archived_at.isoformat() if row.archived_at else None,
        status=row.status,
        turn=row.turn,
        ended_reason=row.ended_reason,
        has_report=bool(row.has_report),
    )


def _archive_view(row: StSessionArchive) -> ScenarioView:
    return ScenarioView.model_validate((row.payload or {}).get("view") or {})


# --------------------------------------------------------------------------- #
# 学生侧
# --------------------------------------------------------------------------- #


@router.get("/packs")
def list_packs(db: DbSession, current_user: _StudentUser) -> list[ScenarioPackSummary]:
    """可用情境包（含最新修订号）。"""
    return [ScenarioPackSummary.model_validate(item) for item in pack_loader.list_packs(db)]


@router.post("/sessions")
async def create_session_route(
    payload: ScenarioOpenSessionRequest,
    request: Request,
    db: DbSession,
    current_user: _StudentUser,
) -> ScenarioSessionResponse:
    """开启一次情境：DM **先立场景**（开场回合），再等学生动手。

    `trial=true`（固定修订试跑）额外要求 `case_manage`，并显式标记该会话。
    """
    await check_scenario_open_limit(current_user.id, request)
    if payload.trial and not current_user.has_permission("case_manage"):
        raise HTTPException(status_code=403, detail="权限不足")
    if payload.revision_id is not None:
        revision_id = payload.revision_id
        pack = _load_pack(db, revision_id)
    else:
        packs = pack_loader.list_packs(db)
        if not packs:
            raise HTTPException(status_code=404, detail="尚无可用情境包")
        key = payload.pack_key or str(packs[0]["key"])
        _, revision = _latest(db, key)
        revision_id = revision.id
        pack = _load_pack(db, revision_id)
    _require_schema_current(pack)
    session, _problems = await create_session(
        db,
        user_id=current_user.id,
        revision_id=revision_id,
        pack=pack,
        llm=request.app.state.llm_client,
        trial=payload.trial,
    )
    session_id = session.id
    view = _live_view(db, session, pack)
    return ScenarioSessionResponse(session_id=session_id, pack=view.pack, view=view)


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
    titles = {key: title for key, title in db.execute(select(StPack.key, StPack.title)).all()}
    turns = session_turns(db, [row.id for row in rows])
    return [
        ScenarioSessionRow.model_validate(session_row(row, titles.get(row.pack_key, row.pack_key), turns[row.id]))
        for row in rows
    ]


@router.get("/sessions/{session_id}")
def get_session(session_id: int, db: DbSession, current_user: _StudentUser) -> ScenarioSessionState:
    """会话当前状态。**已归档（机制切换前）的旧局走归档投影，只读。**"""
    session = _load_session(db, session_id, current_user.id)
    archived = _archive_of(db, session_id)
    if archived is not None:
        payload = archived.payload or {}
        report, legacy_report = _split_report(payload.get("report"))
        return ScenarioSessionState(
            session_id=session_id,
            status=archived.status,
            report=report,
            legacy_report=legacy_report,
            view=_archive_view(archived),
            read_only=True,
            archive=ScenarioArchiveRef(
                archived_at=archived.archived_at.isoformat() if archived.archived_at else None,
                shape_version=archived.shape_version,
                ended_reason=archived.ended_reason,
            ),
        )
    pack = _load_pack(db, session.pack_revision_id)
    report, legacy_report = _split_report(session.report)
    return ScenarioSessionState(
        session_id=session.id,
        status=session.status,
        report=report,
        legacy_report=legacy_report,
        view=_live_view(db, session, pack),
        read_only=session_read_only(session),
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
    pack = _load_pack(db, session.pack_revision_id)
    try:
        return await submit_turn(
            db,
            session=session,
            pack=pack,
            request=payload,
            llm=request.app.state.llm_client,
            user_id=current_user.id,
        )
    except (
        SessionClosed,
        SessionArchived,
        SeqConflict,
        RequestConflict,
        TurnRejected,
        StageFailure,
    ) as exc:
        raise _map_error(exc) from exc


def _sse(event: str, payload: Any) -> str:
    body = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload
    return f"event: {event}\ndata: {json.dumps(body, ensure_ascii=False)}\n\n"


@router.post(
    "/sessions/{session_id}/turns/stream",
    # SSE 的四种事件载荷**也是生成类型**：用联合类型声明响应模型，
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
    """同一回合的 SSE 传输：`phase` / `delivery`（**待提交**）/ `committed` / `error`。

    与 JSON 路径共用 `submit_turn`；这里只把阶段与待提交草稿推出去。
    """
    await check_scenario_action_limit(current_user.id, request)
    session = _load_session(db, session_id, current_user.id)
    pack = _load_pack(db, session.pack_revision_id)
    llm = request.app.state.llm_client
    user_id = current_user.id

    async def event_stream() -> AsyncIterator[str]:
        """**真流式**：阶段与待提交交付随发生即刻到达，不等回合结束一次性喷出。"""
        queue: asyncio.Queue[str] = asyncio.Queue()
        last_phase: dict[str, TurnPhase] = {"value": "receiving"}

        async def on_phase(name: TurnPhase) -> None:
            last_phase["value"] = name
            queue.put_nowait(_sse("phase", ScenarioSsePhase(request_id=payload.request_id, phase=name)))

        async def on_delivery(delivery: Any, seq: int) -> None:
            queue.put_nowait(
                _sse("delivery", ScenarioSseDelivery(request_id=payload.request_id, pending=True, delivery=delivery))
            )

        async def run() -> ScenarioTurnResult:
            return await submit_turn(
                db,
                session=session,
                pack=pack,
                request=payload,
                llm=llm,
                user_id=user_id,
                hooks=TurnHooks(on_phase=on_phase, on_delivery=on_delivery),
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
            if isinstance(
                exc, (SessionClosed, SessionArchived, SeqConflict, RequestConflict, TurnRejected, StageFailure)
            ):
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
                error = ScenarioErrorInfo(code="internal_error", message="服务端异常，本次未提交", retryable=True)
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
    pack = _load_pack(db, session.pack_revision_id)
    try:
        return submit_close(
            db,
            session=session,
            pack=pack,
            request_id=payload.request_id,
            expected_seq=payload.expected_seq,
        )
    except (SessionClosed, SessionArchived, SeqConflict, RequestConflict) as exc:
        raise _map_error(exc) from exc


@router.get("/assets/{revision_id}/{asset_id}")
def get_asset(revision_id: int, asset_id: str, db: DbSession, current_user: _StudentUser) -> Response:
    """提供场景资源（pack 声明的图片）。需要登录态。"""
    pack = _load_pack(db, revision_id)
    try:
        content, mime = assets_mod.read_image(db, pack, asset_id)
    except assets_mod.AssetNotFound as exc:
        raise HTTPException(status_code=404, detail="资源不存在") from exc
    headers = {"Cache-Control": _CACHE_IMMUTABLE if assets_mod.is_generated(asset_id) else _CACHE_REPLACEABLE}
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
        image_generation=pack.image_generation,
    )


@router.get("/admin/packs", dependencies=[_DataViewer])
def admin_packs(db: DbSession) -> list[ScenarioAdminPack]:
    """管理侧：全部情境包（含修订、资源状态、关注点概览、会话数）。"""
    packs = db.execute(select(StPack).order_by(StPack.key)).scalars().all()
    counts = {
        str(key): int(total)
        for key, total in db.execute(
            select(StSession.pack_key, func.count(StSession.id)).group_by(StSession.pack_key)
        ).all()
    }
    out: list[ScenarioAdminPack] = []
    for pack_row in packs:
        revisions = (
            db.execute(
                select(StPackRevision)
                .where(StPackRevision.pack_id == pack_row.id)
                .order_by(StPackRevision.revision_no.desc())
            )
            .scalars()
            .all()
        )
        latest = revisions[0] if revisions else None
        pack = pack_loader.load_revision(db, latest.id) if latest is not None else None
        out.append(
            ScenarioAdminPack(
                key=pack_row.key,
                title=pack_row.title,
                state=pack_row.state,
                one_line=pack_row.one_line,
                revision_id=latest.id if latest else None,
                revision_no=latest.revision_no if latest else None,
                revisions=[
                    ScenarioAdminRevision(id=item.id, no=item.revision_no, note=item.note) for item in revisions
                ],
                assets=[
                    ScenarioAdminAsset.model_validate(item) for item in (assets_mod.describe(db, pack) if pack else [])
                ],
                overview=_pack_overview(pack),
                sessions=int(counts.get(pack_row.key, 0)),
            )
        )
    return out


def _install_pack(db: DbSession, pack: ScenarioPack, *, note: str) -> tuple[StPack, StPackRevision, bool]:
    """装/重装一份包。校验或播种失败一律变成**可读的 422**。"""
    try:
        return pack_loader.install(db, pack, note=note)
    except PackInvalid as exc:
        raise HTTPException(status_code=422, detail={"message": "包未通过校验", "problems": exc.problems}) from exc
    except assets_mod.AssetRejected as exc:
        raise HTTPException(status_code=422, detail={"message": "包内资源无法入库", "problems": [str(exc)]}) from exc


@router.post("/admin/packs", dependencies=[_ContentManager])
async def admin_upload_pack(
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    note: str = Form(default=""),
) -> ScenarioAdminPackUpload:
    """管理侧：上传（或覆盖）一份情境包 JSON → 追加新修订。"""
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
        _, revision, created = _install_pack(db, pack, note=note or f"upload by {current_user.id}")
        assets_pending = assets_mod.seed_from_pack(db, pack)
    return ScenarioAdminPackUpload(
        key=pack.key,
        revision_id=revision.id,
        revision_no=revision.revision_no,
        created=created,
        assets_pending=list(assets_pending),
    )


def _revision_rows(db: DbSession, pack_id: int) -> list[StPackRevision]:
    return list(
        db.execute(
            select(StPackRevision).where(StPackRevision.pack_id == pack_id).order_by(StPackRevision.revision_no.desc())
        )
        .scalars()
        .all()
    )


def _validation_of(db: DbSession, pack_key: str, content: dict[str, Any]) -> ScenarioPackValidation:
    """用**同一套**加载期校验算校验结果与"会不会追加修订"。"""
    problems = pack_loader.validate_content(content)
    sha: str | None = None
    if not problems:
        sha = ScenarioPack.model_validate(content).content_sha()
    revisions = _revision_rows(db, _require_pack(db, pack_key).id)
    latest = revisions[0] if revisions else None
    will_append = sha is None or latest is None or latest.content_sha != sha
    return ScenarioPackValidation(
        ok=not problems,
        problems=[ScenarioPackProblem.model_validate(item) for item in problems],
        content_sha=sha,
        latest_sha=latest.content_sha if latest else None,
        will_append=will_append,
        next_revision_no=(latest.revision_no + 1)
        if (will_append and latest is not None)
        else (1 if will_append else None),
        pack_schema_version=int(content.get("pack_schema_version", PACK_SCHEMA_VERSION)),
    )


@router.get("/admin/packs/{pack_key}/source", dependencies=[_ContentManager])
def admin_pack_source(
    pack_key: str,
    db: DbSession,
    revision_id: int | None = Query(default=None),
) -> ScenarioAdminPackSource:
    """编辑器：读某一修订的**原始内容**（默认最新）。旧形状带 `legacy` 标识，编辑需显式转换。"""
    row = _require_pack(db, pack_key)
    revisions = _revision_rows(db, row.id)
    if not revisions:
        raise HTTPException(status_code=404, detail="这个病例还没有任何修订")
    target = next((item for item in revisions if item.id == revision_id), None)
    if revision_id is not None and target is None:
        raise HTTPException(status_code=404, detail="指定的修订不属于这个病例")
    if target is None:
        target = revisions[0]
    schema_version = int(target.content.get("pack_schema_version", 1))
    problems = pack_loader.validate_content(target.content)
    return ScenarioAdminPackSource(
        key=row.key,
        title=row.title,
        state=row.state,
        revision_id=target.id,
        revision_no=target.revision_no,
        note=target.note,
        content=target.content,
        problems=[ScenarioPackProblem.model_validate(item) for item in problems],
        revisions=[ScenarioAdminRevision(id=item.id, no=item.revision_no, note=item.note) for item in revisions],
        schema_version=schema_version,
        current_schema_version=PACK_SCHEMA_VERSION,
        compatible=schema_version >= PACK_SCHEMA_VERSION,
        legacy=schema_version < PACK_SCHEMA_VERSION,
    )


@router.post("/admin/packs/{pack_key}/validate", dependencies=[_ContentManager])
def admin_validate_pack(pack_key: str, payload: ScenarioPackContentRequest, db: DbSession) -> ScenarioPackValidation:
    """编辑器：保存前校验（不落库）。失败时每条问题都带字段路径。"""
    return _validation_of(db, pack_key, payload.content)


@router.post("/admin/packs/{pack_key}/convert", dependencies=[_ContentManager])
def admin_convert_pack(pack_key: str, payload: ScenarioPackConvertRequest, db: DbSession) -> ScenarioAdminPackConvert:
    """旧修订 → 当前形状草稿的**显式转换**（不静默裁剪未知字段、不宣称语义兼容）。

    输入按 `pack_key + revision_id` 从库里那一版修订读内容——转换只对**真实存在的修订**做，
    客户端手里的 JSON 不作为入口（否则会转换出一份与任何修订都不对应的退化草稿）。
    """
    row = _require_pack(db, pack_key)
    target = next((item for item in _revision_rows(db, row.id) if item.id == payload.revision_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"修订 {payload.revision_id} 不属于这个病例（{pack_key}）")
    content = dict(target.content or {})
    if not content:
        raise HTTPException(status_code=422, detail={"message": "这一修订没有内容，无法转换", "problems": []})
    from_schema = int(content.get("pack_schema_version", 1))
    if from_schema >= PACK_SCHEMA_VERSION:
        # 已经是当前形状：原样返回 + 说明，不报错也不假装"转换过"
        return ScenarioAdminPackConvert(
            content=content,
            notes=["这一版已经是当前形状，无需转换"],
            problems=[ScenarioPackProblem.model_validate(item) for item in pack_loader.validate_content(content)],
            from_schema_version=from_schema,
            to_schema_version=PACK_SCHEMA_VERSION,
        )
    try:
        converted, notes = pack_loader.convert_legacy(content)
    except pack_loader.PackInvalid as exc:
        raise HTTPException(status_code=422, detail={"message": "无法转换", "problems": exc.problems}) from exc
    return ScenarioAdminPackConvert(
        content=converted,
        notes=notes,
        problems=[ScenarioPackProblem.model_validate(item) for item in pack_loader.validate_content(converted)],
        from_schema_version=from_schema,
        to_schema_version=PACK_SCHEMA_VERSION,
    )


@router.post("/admin/packs/{pack_key}/revisions", dependencies=[_ContentManager])
def admin_save_pack_revision(
    pack_key: str,
    payload: ScenarioPackContentRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> ScenarioAdminPackUpload:
    """编辑器保存：**追加新修订**（内容未变则幂等复用既有修订，不产生假修订）。"""
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
        _, revision, created = _install_pack(db, pack, note=payload.note or f"editor by {current_user.id}")
        assets_pending = assets_mod.seed_from_pack(db, pack)
    return ScenarioAdminPackUpload(
        key=pack.key,
        revision_id=revision.id,
        revision_no=revision.revision_no,
        created=created,
        assets_pending=list(assets_pending),
    )


@router.patch("/admin/packs/{pack_key}", dependencies=[_ContentManager])
def admin_patch_pack(pack_key: str, payload: ScenarioPackPatchRequest, db: DbSession) -> dict[str, Any]:
    """管理侧：改包状态/标题。"""
    row = _require_pack(db, pack_key)
    with unit_of_work(db, conflict_detail="更新情境包失败"):
        if payload.state is not None:
            row.state = payload.state.value
        if payload.title is not None:
            row.title = payload.title
        if payload.one_line is not None:
            row.one_line = payload.one_line
    return {"key": row.key, "state": row.state, "title": row.title, "one_line": row.one_line}


@router.get("/admin/packs/{pack_key}/assets/{asset_id}", dependencies=[_DataViewer])
def admin_get_asset(pack_key: str, asset_id: str, db: DbSession) -> Response:
    """管理侧预览：按 pack key 取资源字节。"""
    _, revision = _latest(db, pack_key)
    pack = _load_pack(db, revision.id)
    try:
        content, mime = assets_mod.read_image(db, pack, asset_id)
    except assets_mod.AssetNotFound as exc:
        raise HTTPException(status_code=404, detail="资源不存在") from exc
    headers = {"Cache-Control": _CACHE_IMMUTABLE if assets_mod.is_generated(asset_id) else _CACHE_REPLACEABLE}
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
    suggest_when: str = Form(default=""),
) -> ScenarioAdminAssetUpload:
    """管理侧：上传一张场景图片 → 存字节 + **追加一个声明了它的新修订**。"""
    _, revision = _latest(db, pack_key)
    pack = _load_pack(db, revision.id)
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
        suggest_when=suggest_when,
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
        _, new_revision, _ = _install_pack(db, updated, note=f"asset:{asset_id} by {current_user.id}")
    asset = next(item for item in assets_mod.describe(db, updated) if item["id"] == asset_id)
    return ScenarioAdminAssetUpload(
        key=pack_key, revision_no=new_revision.revision_no, asset=ScenarioAdminAsset.model_validate(asset)
    )


@router.delete("/admin/packs/{pack_key}/assets/{asset_id}", dependencies=[_ContentManager])
def admin_delete_asset(pack_key: str, asset_id: str, db: DbSession) -> dict[str, Any]:
    """管理侧：撤下一张资源（声明从新修订移除；若已无修订引用则连字节一起删）。"""
    _, revision = _latest(db, pack_key)
    pack = _load_pack(db, revision.id)
    if asset_id not in assets_mod.declared_ids(pack):
        raise HTTPException(status_code=404, detail="该包未声明此资源")
    updated = pack.model_copy(update={"assets": [item for item in pack.assets if item.id != asset_id]})
    with unit_of_work(db, conflict_detail="移除资源失败"):
        _, new_revision, _ = _install_pack(db, updated, note=f"drop asset:{asset_id}")
        assets_mod.delete_asset(db, pack_key, asset_id)
    return {"key": pack_key, "revision_no": new_revision.revision_no, "assets": assets_mod.describe(db, updated)}


@router.get("/admin/packs/{pack_key}/generated", dependencies=[_ContentManager])
def admin_generated_assets(
    pack_key: str,
    db: DbSession,
    session_id: int | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ScenarioGeneratedList:
    """管理侧：某个情境包下 DM 现场生成物的清单（按 pack 过滤后分页，不含字节）。"""
    _require_pack(db, pack_key)
    rows, total = assets_mod.list_generated(db, pack_key=pack_key, limit=limit, offset=offset, session_id=session_id)
    return ScenarioGeneratedList(
        items=[ScenarioGeneratedAsset.model_validate(assets_mod.describe_generated(row)) for row in rows],
        total=int(total),
    )


@router.get("/admin/generated/{asset_id}/content", dependencies=[_ContentManager])
def admin_generated_content(asset_id: int, db: DbSession) -> Response:
    """管理侧预览：按生成物 id 取字节。"""
    row = assets_mod.get_generated_asset(db, asset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="生成物不存在")
    return Response(content=bytes(row.content), media_type=row.mime_type, headers={"Cache-Control": _CACHE_IMMUTABLE})


@router.delete("/admin/generated/{asset_id}", dependencies=[_ContentManager])
def admin_delete_generated(asset_id: int, db: DbSession) -> dict[str, Any]:
    """管理侧：删除一条生成物（字节随之回收）。"""
    with unit_of_work(db, conflict_detail="删除生成物失败"):
        if not assets_mod.delete_generated_asset(db, asset_id):
            raise HTTPException(status_code=404, detail="生成物不存在")
    return {"deleted": asset_id, "id": asset_id}


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
    titles = {key: title for key, title in db.execute(select(StPack.key, StPack.title)).all()}
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
    """管理侧：单次会话的完整回放（视图 + 报告 + 每回合解析/结算/交付 + 关注点投影）。"""
    session = _load_session(db, session_id, None)
    pack = _load_pack(db, session.pack_revision_id)
    events = load_events(db, session.id)
    archived = _archive_of(db, session_id) is not None
    problems = [str(item) for event in events for item in ((event.get("payload") or {}).get("problems") or [])]
    view = _live_view(db, session, pack)
    report, _legacy = _split_report(session.report)
    return ScenarioAdminSessionDetail(
        session=ScenarioAdminSessionRow.model_validate(
            session_row(session, pack.title, session_turns(db, [session.id])[session.id])
        ),
        view=view,
        report=report,
        archived=archived,
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


@router.get("/admin/archives", dependencies=[_DataViewer])
def admin_archives(
    db: DbSession,
    pack_key: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ScenarioArchiveList:
    """管理侧：旧机制会话的归档清单（历史只读）。"""
    query = select(StSessionArchive)
    if pack_key:
        query = query.where(StSessionArchive.pack_key == pack_key)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = db.execute(query.order_by(StSessionArchive.session_id.desc()).limit(limit).offset(offset)).scalars().all()
    return ScenarioArchiveList(total=int(total), items=[_archive_summary(row) for row in rows])


@router.get("/admin/archives/{session_id}", dependencies=[_DataViewer])
def admin_archive_detail(session_id: int, db: DbSession) -> ScenarioArchiveDetail:
    """管理侧：单份归档的完整内容（视图 / 报告 / 回放 / 原始事件），**不重算、不补生成报告**。"""
    row = _archive_of(db, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="该会话没有归档")
    payload = row.payload or {}
    report, legacy_report = _split_report(payload.get("report"))
    return ScenarioArchiveDetail(
        summary=_archive_summary(row),
        view=_archive_view(row),
        report=report,
        legacy_report=legacy_report,
        focus=[ScenarioAdminFocusTurn.model_validate(item) for item in payload.get("focus") or []],
        turns=[ScenarioAdminTurnReplay.model_validate(item) for item in payload.get("turns") or []],
        raw=ScenarioArchiveRaw.model_validate(payload.get("raw") or {}),
    )


@router.get("/admin/stats", dependencies=[_DataViewer])
def admin_stats(db: DbSession) -> ScenarioAdminStats:
    """管理侧：按包汇总（会话数、结算数、不可逆结局数、关注点处理比例）。试跑默认排除。"""
    rows = db.execute(
        select(StSession.id, StSession.pack_key, StSession.status, StSession.report, StSession.meta)
    ).all()
    titles = {key: title for key, title in db.execute(select(StPack.key, StPack.title)).all()}
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
