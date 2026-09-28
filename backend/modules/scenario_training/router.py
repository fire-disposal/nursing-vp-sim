"""`/api/scenario/**` —— 情境训练实验接口（学生侧 + 管理侧）。

- **默认关闭**（`SCENARIO_TRAINING_ENABLED`）：关闭时整个命名空间 404，对老系统与学生界面零可见。
- 学生侧判 `scenario_training`（2026-09-27 转公开测试时补的专用键，学生/教师/管理员都持有）；
  **管理侧复用既有权限**：内容用 `case_manage`、数据用 `stats_view`。
- 会话只能被本人读取与操作；管理侧可读全部会话（含每回合的**问题清单**，供维护者排查）。
- 资源字节存库（`st_assets`）：管理侧上传即**追加一个新修订**——内容与字节一起版本化。
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from core.config import SCENARIO_TRAINING_ENABLED
from core.deps import CurrentUser, DbSession
from core.exceptions import ConflictError
from core.rate_limits import check_scenario_action_limit, check_scenario_open_limit
from core.security import require_permission
from core.unit_of_work import unit_of_work
from models import User
from models.scenario_training import StEvent, StPack, StPackRevision, StSession

from . import assets as assets_mod
from . import pack_loader
from .dm.runner import iter_dm_stream
from .judge.rules import dims_snapshot
from .pack_loader import PackInvalid, PackNotFound
from .runtime.anchors import AnchorState, anchor_turns, compute_anchors
from .runtime.session import (
    SessionClosed,
    StudentAction,
    close_session,
    dm_step_reporter,
    load_events,
    open_session,
    opening_turn,
    replay,
    submit_action,
)
from .runtime.view import build_view
from .runtime.world import ActionRecord, apply_effects, due_reactions, reveal_cues
from .schema import PACK_SCHEMA_VERSION, Asset, PackState, Presence, ScenarioPack
from .validation import validate_pack

_ContentManager = Depends(require_permission("case_manage"))
_DataViewer = Depends(require_permission("stats_view"))
# 学生侧专用门禁：`scenario_training`（权限键见 core/permissions.py，角色授予见 core/roles.py）。
_StudentUser = Annotated[User, Depends(require_permission("scenario_training"))]

log = logging.getLogger(__name__)

_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# 图片响应都过登录态，只能进**私有**缓存。生成物按行 id 取字节、内容只增不改 → 可以久缓存；
# 上传资源同名可被覆盖重传 → 只短缓存，免得管理员换图后学生仍看到旧图。
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


class OpenSessionRequest(BaseModel):
    pack_key: str | None = None
    revision_id: int | None = None


class ActionRequest(BaseModel):
    """学生的一次发言/动作。

    `type` 由学生**先声明**：`say` = 对某个在场者说话（带 `target_actor_id`）/ `act` = 自定义行动 /
    `ask` = 旧客户端与 DM 选项的既有形态（不声明，行为与今天一致）。
    """

    affordance_id: str | None = None
    type: str = "ask"
    text: str | None = Field(default=None, max_length=2000)
    selected: list[str] = Field(default_factory=list)
    custom_text: str | None = Field(default=None, max_length=2000)
    # 对在场者说话的收信人；「自定义行动」不带。必须是该 pack 已声明且**搭得上话**的 actor id
    # （见 `_require_target_actor`：未声明或不在场 → 422，不静默丢弃）。
    target_actor_id: str | None = None


class PackPatchRequest(BaseModel):
    state: PackState | None = None
    title: str | None = Field(default=None, max_length=200)
    one_line: str | None = Field(default=None, max_length=400)


def _load_pack(db: DbSession, revision_id: int) -> ScenarioPack:
    try:
        return pack_loader.load_revision(db, revision_id)
    except PackNotFound as exc:
        raise HTTPException(status_code=404, detail="情境包修订不存在") from exc
    except PackInvalid as exc:
        raise HTTPException(status_code=422, detail={"message": "情境包未通过校验", "problems": exc.problems}) from exc


def _require_target_actor(pack: ScenarioPack, target_actor_id: str | None) -> None:
    """学生声明的收信人必须**对得上这个 pack 的在场者**：未声明或搭不上话 → 422（不静默丢弃）。

    判据与前端 chip 的过滤同一条：`presence == "inaccessible"`（看得见、碰不着）不是可搭话的对象。
    `problems` 与 pack 校验失败同形，前端因此能把它当人话显示。
    """
    if target_actor_id is None:
        return
    actor = pack.actor(target_actor_id)
    if actor is None:
        raise HTTPException(
            status_code=422,
            detail={"message": "这个情境里没有这个人", "problems": [f"unknown_target_actor:{target_actor_id}"]},
        )
    if actor.presence is Presence.INACCESSIBLE:
        raise HTTPException(
            status_code=422,
            detail={"message": "这个人此刻搭不上话", "problems": [f"unreachable_target_actor:{target_actor_id}"]},
        )


def _latest(db: DbSession, pack_key: str) -> tuple[StPack, StPackRevision]:
    latest = pack_loader.latest_revision(db, pack_key)
    if latest is None:
        raise HTTPException(status_code=404, detail=f"情境包不存在：{pack_key}")
    return latest


def _load_session(db: DbSession, session_id: int, user_id: int | None) -> StSession:
    session = db.execute(select(StSession).where(StSession.id == session_id)).scalar_one_or_none()
    if session is None or (user_id is not None and session.user_id != user_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return session


def _view(db: DbSession, session: StSession, pack: ScenarioPack, problems: list[str] | None = None) -> dict[str, Any]:
    world = replay(db, session, pack)
    return build_view(
        pack,
        world,
        session_id=session.id,
        status=session.status,
        revision_id=session.pack_revision_id,
        problems=problems,
        dims=dims_snapshot(pack, world),  # 回放视图也要带经历量化投影（与实时回合一致）
    )


# ── 学生侧 ──────────────────────────────────────────────────────────────────


@router.get("/packs")
def list_packs(db: DbSession, current_user: _StudentUser) -> list[dict[str, Any]]:
    """可用情境包（含最新修订号）。

    投影见 `pack_loader.list_packs`：展示字段 + 最新修订号，另带两项**学生语义**字段
    `player_role`（你将扮演谁）/ `place`（在哪儿）供入口页卡片选情境用。形状未声明
    response model（历史如此），前端按 `frontend/src/api/scenario.ts` 的 `ScenarioPackSummary` 镜像消费。
    """
    return pack_loader.list_packs(db)


@router.post("/sessions")
async def create_session(
    payload: OpenSessionRequest,
    request: Request,
    db: DbSession,
    current_user: _StudentUser,
) -> dict[str, Any]:
    """开启一次情境：DM **先立场景**（开场回合），再等学生动手。未指定 revision 时取最新修订。"""
    await check_scenario_open_limit(current_user.id, request)
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

    with unit_of_work(db, conflict_detail="开启情境失败"):
        session = open_session(db, user_id=current_user.id, revision_id=revision_id, pack=pack)
        await opening_turn(
            db,
            session=session,
            pack=pack,
            llm=request.app.state.llm_client,
            user_id=current_user.id,
            image_provider=assets_mod.get_image_provider(request.app.state),
        )
    session_id = session.id
    return {
        "session_id": session_id,
        "pack": {"key": pack.key, "title": pack.title, "revision_id": revision_id},
        "view": _view(db, session, pack),
    }


@router.get("/sessions")
def my_sessions(
    db: DbSession,
    current_user: _StudentUser,
    limit: int = Query(default=30, ge=1, le=200),
) -> list[dict[str, Any]]:
    """我的情境历史（学生侧）。"""
    rows = (
        db.execute(
            select(StSession).where(StSession.user_id == current_user.id).order_by(StSession.id.desc()).limit(limit)
        )
        .scalars()
        .all()
    )
    titles = {key: title for key, title in db.execute(select(StPack.key, StPack.title)).all()}
    turns = _session_turns(db, rows)
    return [_session_row(row, titles.get(row.pack_key, row.pack_key), turns[row.id]) for row in rows]


@router.get("/sessions/{session_id}")
def get_session(session_id: int, db: DbSession, current_user: _StudentUser) -> dict[str, Any]:
    session = _load_session(db, session_id, current_user.id)
    pack = _load_pack(db, session.pack_revision_id)
    return {
        "session_id": session.id,
        "status": session.status,
        "report": session.report,
        "view": _view(db, session, pack),
    }


@router.post("/sessions/{session_id}/actions")
async def submit(
    session_id: int,
    payload: ActionRequest,
    request: Request,
    db: DbSession,
    current_user: _StudentUser,
) -> dict[str, Any]:
    """学生做一件事 → 世界回应 → 返回新视图。"""
    await check_scenario_action_limit(current_user.id, request)
    session = _load_session(db, session_id, current_user.id)
    pack = _load_pack(db, session.pack_revision_id)
    _require_target_actor(pack, payload.target_actor_id)
    action = StudentAction(
        affordance_id=payload.affordance_id,
        type=payload.type,
        text=payload.text,
        selected=payload.selected,
        custom_text=payload.custom_text,
        target_actor_id=payload.target_actor_id,
    )
    try:
        with unit_of_work(db, conflict_detail="提交动作失败"):
            outcome = await submit_action(
                db,
                session=session,
                pack=pack,
                action=action,
                llm=request.app.state.llm_client,
                user_id=current_user.id,
                image_provider=assets_mod.get_image_provider(request.app.state),
            )
    except SessionClosed as exc:
        raise HTTPException(status_code=409, detail="该情境已结束") from exc
    return {"session_id": session.id, "problems": outcome.problems, "view": outcome.view}


@router.post("/sessions/{session_id}/actions/stream")
async def submit_stream(
    session_id: int,
    payload: ActionRequest,
    request: Request,
    db: DbSession,
    current_user: _StudentUser,
) -> StreamingResponse:
    """**流式**提交同一回合：先按块推 DM 输出（叙述块写完就渲染），最后给权威视图。

    展示可以增量，**状态改动仍等完整回合校验后落地**（不会出现"半应用的世界"）。
    """
    await check_scenario_action_limit(current_user.id, request)
    session = _load_session(db, session_id, current_user.id)
    pack = _load_pack(db, session.pack_revision_id)
    _require_target_actor(pack, payload.target_actor_id)
    action = StudentAction(
        affordance_id=payload.affordance_id,
        type=payload.type,
        text=payload.text,
        selected=payload.selected,
        custom_text=payload.custom_text,
        target_actor_id=payload.target_actor_id,
    )
    llm = request.app.state.llm_client
    image_provider = assets_mod.get_image_provider(request.app.state)

    async def event_stream():
        def send(payload_obj: dict[str, Any]) -> str:
            return f"data: {json.dumps(payload_obj, ensure_ascii=False)}\n\n"

        try:
            # 先只读地推断本回合"必然发生"的事（与落地路径同一套确定性规则）
            world = replay(db, session, pack)
            preview = world.clone()
            affordance = pack.affordance(action.affordance_id) if action.affordance_id else None
            if affordance is not None:
                apply_effects(pack, preview, affordance.effects, source=f"affordance:{affordance.id}")
                reveal_cues(pack, preview, affordance.reveals)
            beats = [
                {"reaction": reaction.id, "by": reaction.by, "does": reaction.does, "intent": reaction.intent}
                for reaction in due_reactions(pack, world, preview)
            ]

            dm_turn = None
            dm_problems: list[str] = []
            record = ActionRecord(
                turn=world.turn + 1,
                affordance_id=action.affordance_id,
                type=action.type,
                text=action.text,
                selected=list(action.selected),
                custom_text=action.custom_text,
                target_actor_id=action.target_actor_id,
            )
            async for item in iter_dm_stream(
                llm,
                pack,
                world,
                record,
                beats,
                user_id=current_user.id,
                on_step=dm_step_reporter(db, session.id),
                anchors=compute_anchors(pack, load_events(db, session.id)),
            ):
                if item["kind"] == "blocks":
                    yield send({"kind": "blocks", "blocks": item["blocks"]})
                else:
                    dm_turn, dm_problems = item["turn"], item["problems"]

            if dm_turn is None:
                yield send({"kind": "error", "message": "本回合没有拿到可用输出"})
                return

            with unit_of_work(db, conflict_detail="提交动作失败"):
                outcome = await submit_action(
                    db,
                    session=session,
                    pack=pack,
                    action=action,
                    llm=llm,
                    user_id=current_user.id,
                    image_provider=image_provider,
                    dm_turn=dm_turn,
                    dm_problems=dm_problems,
                )
            yield send({"kind": "view", "view": outcome.view, "problems": outcome.problems, "session_id": session.id})
        except SessionClosed:
            yield send({"kind": "error", "message": "该情境已结束"})
        except (ConflictError, ValueError, RuntimeError) as exc:
            # 已知失败面（并发冲突 / 校验 / 运行时）→ 给一条人话，不吐半个流；未知异常交给框架处理
            log.warning("scenario stream failed: %s", exc)
            yield send({"kind": "error", "message": "本回合生成中断，请重试"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/sessions/{session_id}/close")
def close(session_id: int, db: DbSession, current_user: _StudentUser) -> dict[str, Any]:
    """结束并结算判读（规则可复算；不启用能力等第）。"""
    session = _load_session(db, session_id, current_user.id)
    pack = _load_pack(db, session.pack_revision_id)
    if session.status != "active":
        return {"session_id": session.id, "report": session.report, "view": _view(db, session, pack)}
    with unit_of_work(db, conflict_detail="结束情境失败"):
        report = close_session(db, session=session, pack=pack)
    return {"session_id": session.id, "report": report, "view": _view(db, session, pack)}


@router.get("/assets/{revision_id}/{asset_id}")
def get_asset(revision_id: int, asset_id: str, db: DbSession, current_user: _StudentUser) -> Response:
    """提供场景资源（pack 声明的图片 / 绘画者 AI 的生成图）。需要登录态。"""
    pack = _load_pack(db, revision_id)
    try:
        content, mime = assets_mod.read_image(db, pack, asset_id)
    except assets_mod.AssetNotFound as exc:
        raise HTTPException(status_code=404, detail="资源不存在") from exc
    headers = {"Cache-Control": _CACHE_IMMUTABLE if assets_mod.is_generated(asset_id) else _CACHE_REPLACEABLE}
    return Response(content=content, media_type=mime, headers=headers)


# ── 管理侧（内容：case_manage） ─────────────────────────────────────────────


def _session_turns(db: DbSession, rows: Sequence[StSession]) -> dict[int, int]:
    """每个会话**实际跑到第几回合**（一次分组查询，不做 N+1）。

    `st_sessions.report` 只在**结算**时写入，直接读 `report["turn"]` 会把"已经做过三个动作"的
    进行中会话写成 0 —— 学生面就会显示成"未开始"，而学生明明已经动手了（生产实测如此）。
    这里以事件流为准：`dm_turn` / `student_action` 里的 `turn` 与回放视图的 `world.turn` 同源；
    已结算会话两者一致（本地 20/20 相同），所以这**不是**在改结算口径，只是把进行中的会话也说出来。
    """
    if not rows:
        return {}
    ids = [row.id for row in rows]
    found: dict[int, int] = {}
    for session_id, turn in db.execute(
        select(
            StEvent.session_id,
            func.max(StEvent.payload["turn"].as_integer()),
        )
        .where(
            StEvent.session_id.in_(ids),
            StEvent.kind.in_(("student_action", "dm_turn")),
        )
        .group_by(StEvent.session_id)
    ).all():
        found[int(session_id)] = int(turn or 0)
    return {row.id: found.get(row.id, 0) for row in rows}


def _session_row(row: StSession, pack_title: str, turn: int) -> dict[str, Any]:
    report = row.report or {}
    return {
        "id": row.id,
        "user_id": row.user_id,
        "pack_key": row.pack_key,
        "pack_title": pack_title,
        "pack_revision_id": row.pack_revision_id,
        "status": row.status,
        # 回合数以事件流为准（进行中会话的 report 还没写）；结算后两者一致
        "turn": turn or report.get("turn"),
        "lost": report.get("lost"),
        "summary": report.get("summary"),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _pack_overview(pack: ScenarioPack | None) -> dict[str, Any] | None:
    """管理侧总览：把这份病例**声明了什么**摊平（角色 / 场景 / 在场者 / 锚点 / 各栏计数）。

    只是读投影：`truth`、`hidden_from_player`、actor 的 `knowledge` 是 DM 侧的防泄漏边界，
    管理界面不需要"患者藏着什么"，所以一个都不出现在这里——多一处副本就多一处泄漏面。
    """
    if pack is None:
        return None
    return {
        "player_role": pack.player.role,
        "place": pack.setting.place,
        "time_hint": pack.setting.time_hint,
        "resources": list(pack.setting.resources),
        "actors": [{"id": actor.id, "role": actor.role, "presence": actor.presence} for actor in pack.actors],
        "anchors": [{"id": anchor.id, "stage": anchor.stage, "goal": anchor.goal} for anchor in pack.anchors],
        "cues": len(pack.setting.cues),
        "affordances": len(pack.affordances),
        "reactions": len(pack.reactions),
        "facts": len(pack.facts),
        "criteria": len(pack.rubric),
        "criteria_weight": sum(item.weight for item in pack.rubric),
        "failure": pack.failure,
        "image_generation": pack.image_generation,
    }


@router.get("/admin/packs", dependencies=[_DataViewer])
def admin_packs(db: DbSession) -> list[dict[str, Any]]:
    """管理侧：全部情境包（含修订、资源状态、会话数）。"""
    packs = db.execute(select(StPack).order_by(StPack.key)).scalars().all()
    counts = {
        str(key): int(total)
        for key, total in db.execute(
            select(StSession.pack_key, func.count(StSession.id)).group_by(StSession.pack_key)
        ).all()
    }
    out: list[dict[str, Any]] = []
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
            {
                "key": pack_row.key,
                "title": pack_row.title,
                "state": pack_row.state,
                "one_line": pack_row.one_line,
                "revision_id": latest.id if latest else None,
                "revision_no": latest.revision_no if latest else None,
                "revisions": [{"id": item.id, "no": item.revision_no, "note": item.note} for item in revisions],
                "assets": assets_mod.describe(db, pack) if pack else [],
                # 病例工作区的「概览」读它：最新修订声明了什么（老修订可能已不合当前 schema，
                # 只取最新那一份——`load_revision` 在历史修订上会如实报错，这里不越界去读）
                "overview": _pack_overview(pack),
                "sessions": int(counts.get(pack_row.key, 0)),
            }
        )
    return out


def _install_pack(db: DbSession, pack: ScenarioPack, *, note: str) -> tuple[StPack, StPackRevision, bool]:
    """装/重装一份包。校验或播种失败一律变成**可读的 422**（与资源声明校验失败同形）。

    不这样做时 `PackInvalid`（RuntimeError）会一路冒到框架变成 500，管理员只看到"服务器错误"，
    既不知道为什么、也不知道改哪里。异常抛出时调用方的 `unit_of_work` 会整体回滚，不留半截数据。
    """
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
) -> dict[str, Any]:
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
        # 播种与修订在**同一事务**里：播种失败不会留下"包已入库、资源没入库"的半截状态。
        assets_pending = assets_mod.seed_from_pack(db, pack)
    return {
        "key": pack.key,
        "revision_id": revision.id,
        "revision_no": revision.revision_no,
        "created": created,
        "assets_pending": assets_pending,
    }


# --------------------------------------------------------------------------- #
# 场景编辑器（管理侧「编辑」块）
#
# 三条路，一条真源：
# - **读**：`GET .../source` 给编辑器的**原始 content**（不是概览投影——编辑器要改的就是它）；
# - **校验**：`POST .../validate` 走 `pack_loader.validate_content`（与安装/加载同一套校验，
#   不新增第二套），把问题翻成"字段路径 + 原因"；
# - **写**：`POST .../revisions` 一律**追加新修订**（`_install_pack`），内容未变则幂等复用。
# 编辑器**永不原地修改**：没有 PATCH 修订内容的接口。
# --------------------------------------------------------------------------- #


class PackContentRequest(BaseModel):
    """编辑器提交的完整 pack 内容（原始 dict，形状由引擎校验）。"""

    content: dict[str, Any]
    note: str = Field(default="", max_length=200)


class PackValidation(BaseModel):
    ok: bool
    problems: list[dict[str, str]]
    """`{"path": "affordances[suction].type", "message": …}`；`ok=false` 时非空。"""
    content_sha: str | None
    latest_sha: str | None
    will_append: bool
    """内容与最新修订不同 → 保存会追加新修订；相同 → 幂等复用（不产生假修订）。"""
    next_revision_no: int | None
    pack_schema_version: int


def _revision_rows(db: DbSession, pack_id: int) -> list[StPackRevision]:
    return list(
        db.execute(
            select(StPackRevision).where(StPackRevision.pack_id == pack_id).order_by(StPackRevision.revision_no.desc())
        )
        .scalars()
        .all()
    )


def _validation_of(db: DbSession, pack_key: str, content: dict[str, Any]) -> PackValidation:
    """用**同一套**加载期校验算校验结果与"会不会追加修订"（保存前的确认摘要据此显示）。"""
    problems = pack_loader.validate_content(content)
    sha: str | None = None
    if not problems:
        sha = ScenarioPack.model_validate(content).content_sha()
    revisions = _revision_rows(db, _require_pack(db, pack_key).id)
    latest = revisions[0] if revisions else None
    will_append = sha is None or latest is None or latest.content_sha != sha
    return PackValidation(
        ok=not problems,
        problems=problems,
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
) -> dict[str, Any]:
    """编辑器：读某个病例**某一修订的原始内容**（默认最新修订）。

    返回的 `problems` 是拿当前校验器跑这份内容的结果——历史修订可能已不合今天的 schema，
    编辑器据此如实提示"载入即为修复起点"，而不是假装它一定干净。
    """
    row = _require_pack(db, pack_key)
    revisions = _revision_rows(db, row.id)
    if not revisions:
        raise HTTPException(status_code=404, detail="这个病例还没有任何修订")
    target = next((item for item in revisions if item.id == revision_id), None)
    if revision_id is not None and target is None:
        raise HTTPException(status_code=404, detail="指定的修订不属于这个病例")
    if target is None:
        target = revisions[0]
    return {
        "key": row.key,
        "title": row.title,
        "state": row.state,
        "revision_id": target.id,
        "revision_no": target.revision_no,
        "note": target.note,
        "content": target.content,
        "problems": pack_loader.validate_content(target.content),
        "revisions": [{"id": item.id, "no": item.revision_no, "note": item.note} for item in revisions],
    }


@router.post("/admin/packs/{pack_key}/validate", dependencies=[_ContentManager])
def admin_validate_pack(pack_key: str, payload: PackContentRequest, db: DbSession) -> PackValidation:
    """编辑器：保存前校验（不落库）。失败时每条问题都带字段路径，供界面定位。"""
    return _validation_of(db, pack_key, payload.content)


@router.post("/admin/packs/{pack_key}/revisions", dependencies=[_ContentManager])
def admin_save_pack_revision(
    pack_key: str,
    payload: PackContentRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> dict[str, Any]:
    """编辑器保存：**追加新修订**（内容未变则幂等复用既有修订，不产生假修订）。"""
    problems = pack_loader.validate_content(payload.content)
    if problems:
        raise HTTPException(
            status_code=422,
            detail={"message": "包未通过校验", "problems": problems},
        )
    pack = ScenarioPack.model_validate(payload.content)
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
    return {
        "key": pack.key,
        "revision_id": revision.id,
        "revision_no": revision.revision_no,
        "created": created,
        "assets_pending": assets_pending,
    }


@router.patch("/admin/packs/{pack_key}", dependencies=[_ContentManager])
def admin_patch_pack(pack_key: str, payload: PackPatchRequest, db: DbSession) -> dict[str, Any]:
    """管理侧：改包状态/标题（`state` 区分 experimental / reviewed）。"""
    row = db.execute(select(StPack).where(StPack.key == pack_key)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="情境包不存在")
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
) -> dict[str, Any]:
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
    return {
        "key": pack_key,
        "revision_no": new_revision.revision_no,
        "asset": next(item for item in assets_mod.describe(db, updated) if item["id"] == asset_id),
    }


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


def _require_pack(db: DbSession, pack_key: str) -> StPack:
    row = db.execute(select(StPack).where(StPack.key == pack_key)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail=f"情境包不存在：{pack_key}")
    return row


@router.get("/admin/packs/{pack_key}/generated", dependencies=[_ContentManager])
def admin_generated_assets(
    pack_key: str,
    db: DbSession,
    session_id: int | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """管理侧：某个情境包下 DM 现场生成物的清单（按 pack 过滤后分页）。

    生成物是**跟着病例走的**：入口在病例二级界面里，因此列表以 `pack_key` 为作用域，
    `session_id` 可再收窄到一次会话。列表**不含字节**（要能翻页），预览走内容路由。
    """
    _require_pack(db, pack_key)
    rows, total = assets_mod.list_generated(db, pack_key=pack_key, limit=limit, offset=offset, session_id=session_id)
    return {"items": [assets_mod.describe_generated(row) for row in rows], "total": total}


@router.get("/admin/generated/{asset_id}/content", dependencies=[_ContentManager])
def admin_generated_content(asset_id: int, db: DbSession) -> Response:
    """管理侧预览：按生成物 id 取字节。"""
    row = assets_mod.get_generated_asset(db, asset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="生成物不存在")
    return Response(
        content=bytes(row.content),
        media_type=row.mime_type,
        headers={"Cache-Control": _CACHE_IMMUTABLE},
    )


@router.delete("/admin/generated/{asset_id}", dependencies=[_ContentManager])
def admin_delete_generated(asset_id: int, db: DbSession) -> dict[str, Any]:
    """管理侧：删除一条生成物（字节随之回收；会话里引用它的那张图变成 404）。"""
    with unit_of_work(db, conflict_detail="删除生成物失败"):
        if not assets_mod.delete_generated_asset(db, asset_id):
            raise HTTPException(status_code=404, detail="生成物不存在")
    return {"deleted": asset_id}


# ── 管理侧（数据：stats_view） ──────────────────────────────────────────────


@router.get("/admin/sessions", dependencies=[_DataViewer])
def admin_sessions(
    db: DbSession,
    pack_key: str | None = None,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """管理侧：会话列表（可按包/状态过滤）。"""
    query = select(StSession)
    if pack_key:
        query = query.where(StSession.pack_key == pack_key)
    if status:
        query = query.where(StSession.status == status)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0
    rows = db.execute(query.order_by(StSession.id.desc()).limit(limit).offset(offset)).scalars().all()
    titles = {key: title for key, title in db.execute(select(StPack.key, StPack.title)).all()}
    turns = _session_turns(db, rows)
    return {
        "total": int(total),
        "items": [_session_row(row, titles.get(row.pack_key, row.pack_key), turns[row.id]) for row in rows],
    }


@router.get("/admin/sessions/{session_id}", dependencies=[_DataViewer])
def admin_session_detail(session_id: int, db: DbSession) -> dict[str, Any]:
    """管理侧：单次会话的完整回放（视图 + 报告 + 每回合问题清单 + **锚点面板**）。"""
    session = _load_session(db, session_id, None)
    pack = _load_pack(db, session.pack_revision_id)
    events = load_events(db, session.id)
    problems = [
        problem
        for event in events
        if event["kind"] == "dm_turn"
        for problem in (event["payload"] or {}).get("problems", [])
    ]
    return {
        "session": _session_row(session, pack.title, _session_turns(db, [session])[session.id]),
        "view": _view(db, session, pack),
        "report": session.report,
        "problems": problems,
        "anchors": _anchor_replay(pack, events),
        "event_count": len(events),
        "events": [
            {"kind": event["kind"], "payload": event["payload"]}
            for event in events
            if event["kind"]
            in {"student_action", "action_attributed", "dm_step", "dm_turn", "entity_line", "session_closed"}
        ],
    }


def _anchor_state(state: AnchorState) -> dict[str, Any]:
    """一个锚点在某回合的状态（教师/管理侧才看得到；`goal` 本来就只给教师与回放）。"""
    return {
        "id": state.id,
        "stage": state.stage,
        "goal": state.goal,
        "status": state.status.value,
        "reason": state.reason,
        "active_since": state.active_since,
        "overdue": state.overdue,
        "nudge": state.nudge,
        "missing_requires": list(state.missing_requires),
        "satisfied_requires": list(state.satisfied_requires),
    }


def _anchor_replay(pack: ScenarioPack, events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """教师/管理回放的**锚点面板**（docs/21 §五）：逐回合状态 + 每回合的催办与被拒提案。

    纯投影：状态一律由 `runtime/anchors.py` 的重算给出（这里不另写判据，也不落新真源）。
    **未声明 anchors 的病例 → `None`**（回放界面据此整块不渲染）。
    """
    turns = anchor_turns(pack, events)
    if not turns:
        return None
    return {
        "count": len(turns[0].states),
        "turns": [
            {
                "turn": turn.turn,
                "states": [_anchor_state(state) for state in turn.states],
                "rejected": [dict(item) for item in turn.rejected],
            }
            for turn in turns
        ],
    }


@router.get("/admin/stats", dependencies=[_DataViewer])
def admin_stats(db: DbSession) -> dict[str, Any]:
    """管理侧：按包汇总（会话数、结算数、不可逆结局数、锚点分布）。"""
    rows = db.execute(select(StSession.pack_key, StSession.status, StSession.report)).all()
    titles = {key: title for key, title in db.execute(select(StPack.key, StPack.title)).all()}
    stats: dict[str, dict[str, Any]] = {}
    for pack_key, status, report in rows:
        bucket = stats.setdefault(
            pack_key,
            {
                "pack_key": pack_key,
                "pack_title": titles.get(pack_key, pack_key),
                "sessions": 0,
                "completed": 0,
                "lost": 0,
                "anchors": {"strong": 0, "adequate": 0, "missed": 0},
            },
        )
        bucket["sessions"] += 1
        if status == "completed":
            bucket["completed"] += 1
        payload = report or {}
        if payload.get("lost"):
            bucket["lost"] += 1
        for anchor, count in (payload.get("summary") or {}).items():
            if anchor in bucket["anchors"]:
                bucket["anchors"][anchor] += int(count)
    return {"packs": sorted(stats.values(), key=lambda item: item["pack_key"])}
