"""旧机制会话的**保真归档**（docs/23 §9）：不可变、按原会话唯一、绝不改写原始数据。

归档里分三块，各自的可信来源写清：

| 块 | 来源 | 说明 |
|---|---|---|
| `raw` | 原 `st_events` / `st_pack_revisions` / `st_sessions` | **原始证据**，一字不改（归档只是副本） |
| `report` | `st_sessions.report` **原样复制** | 旧局本来没有报告就留空——**绝不补生成一份新成绩** |
| `projections` | 旧实现导出的 `legacy` 包，或本次折叠的结果 | `projection_source` 标明是哪一种，不冒充旧渲染 |

切换时先 **dry-run** 给出数量与差异，再在维护窗口 **apply**；**绝不**由应用启动自动封存活动会话。
未结束的旧局以 `abandoned` + `meta.abandoned_reason="mechanism_cutover"` 封存——不补成学生主动完成。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select

from models.scenario_training import StEvent, StSession, StSessionArchive

from ..api_models import ScenarioAdminTurnReplay
from ..schema import ScenarioPack
from .replay import admin_turns, focus_turns
from .session import current_seq, load_events, session_meta
from .view import build_view
from .world import world_from_events

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as OrmSession

ARCHIVE_SHAPE_VERSION = 1
CUTOVER_REASON = "mechanism_cutover"


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _session_row(session: StSession, world_turn: int) -> dict[str, Any]:
    return {
        "id": session.id,
        "user_id": session.user_id,
        "pack_key": session.pack_key,
        "pack_revision_id": session.pack_revision_id,
        "status": session.status,
        "report": session.report,
        "meta": session_meta(session),
        "turn": world_turn,
        "created_at": _iso(session.created_at),
        "updated_at": _iso(session.updated_at),
    }


def build_archive(
    session: StSession,
    pack: ScenarioPack,
    events: list[dict[str, Any]],
    *,
    pack_revision: dict[str, Any],
    legacy: dict[str, Any] | None = None,
    ended_reason: str = "",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """产出 `(payload, summary_fields)`。

    归档里有两份投影，来源写得明明白白：

    - `view`：**新形状**的学生视图（由本次折叠从原始事件重放得到）——新 UI 靠它渲染历史；
    - `legacy`：**旧实现原样快照**（`legacy_export` 给的那份 view / 逐回合视图 / 关键回合），
      不做形状转换、不重新解释；没有 `--legacy` 时该键为 `null` 并如实标注。

    `report` **原样复制** `st_sessions.report`：旧局本来没有就留空，绝不补生成新成绩。
    """
    world = world_from_events(pack, events)
    view = build_view(
        pack,
        world,
        session_id=session.id,
        status=session.status,
        revision_id=session.pack_revision_id,
        read_only=True,
        trial=bool(session_meta(session).get("trial")),
    )
    legacy_block = None
    if legacy:
        legacy_block = {
            "projection_source": "legacy_export",
            "view": legacy.get("view"),
            "turn_views": list(legacy.get("turn_views") or []),
            "key_turns": list(legacy.get("turns") or []),
            "report": legacy.get("report"),
        }
    key_turns = [
        {"turn": item.turn, "student": item.student, "evidence": item.evidence, "changes": item.changes}
        for item in _key_turns(pack, world)
    ]
    report = session.report  # **原样**：旧局没报告就留空
    payload = {
        "shape_version": ARCHIVE_SHAPE_VERSION,
        "view_source": "new_fold",
        "legacy": legacy_block,
        "archived_at": datetime.now(UTC).isoformat(),
        "ended_reason": ended_reason,
        "session": _session_row(session, world.turn),
        "view": view.model_dump(mode="json"),
        "report": report,
        "focus": [item.model_dump(mode="json") for item in focus_turns(pack, events)],
        "turns": [_dump_turn(item) for item in admin_turns(events)],
        "key_turns": key_turns,
        "raw": {
            "events": [
                {
                    "seq": int(event.get("seq") or 0),
                    "kind": str(event.get("kind")),
                    "payload": event.get("payload") or {},
                }
                for event in events
            ],
            "pack_revision": pack_revision,
        },
    }
    summary = {
        "pack_key": session.pack_key,
        "pack_revision_id": session.pack_revision_id,
        "shape_version": ARCHIVE_SHAPE_VERSION,
        "status": session.status,
        "turn": world.turn,
        "ended_reason": ended_reason,
        "has_report": bool(report),
    }
    return payload, summary


def _dump_turn(turn: ScenarioAdminTurnReplay) -> dict[str, Any]:
    return turn.model_dump(mode="json")


def _key_turns(pack: ScenarioPack, world: Any) -> list[Any]:
    from .report import key_turns

    return key_turns(pack, world)


def archive_session(
    db: OrmSession,
    session: StSession,
    pack: ScenarioPack,
    *,
    pack_revision: dict[str, Any],
    legacy: dict[str, Any] | None = None,
    ended_reason: str = "",
    note: str = "",
) -> StSessionArchive:
    """写入（或复用）一份归档。已存在则不覆盖（归档不可变）。"""
    existing = db.execute(
        select(StSessionArchive).where(StSessionArchive.session_id == session.id)
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    events = load_events(db, session.id)
    payload, summary = build_archive(
        session, pack, events, pack_revision=pack_revision, legacy=legacy, ended_reason=ended_reason
    )
    row = StSessionArchive(
        session_id=session.id,
        pack_key=summary["pack_key"],
        pack_revision_id=summary["pack_revision_id"],
        shape_version=summary["shape_version"],
        status=summary["status"],
        turn=summary["turn"],
        ended_reason=summary["ended_reason"],
        has_report=summary["has_report"],
        payload=payload,
        note=note,
    )
    db.add(row)
    db.flush()
    return row


def plan(db: OrmSession) -> dict[str, Any]:
    """dry-run：数量与差异（不改任何数据）。"""
    sessions = db.execute(select(StSession).order_by(StSession.id)).scalars().all()
    archived = {int(session_id) for (session_id,) in db.execute(select(StSessionArchive.session_id)).all()}
    counts = {"total": len(sessions), "archived": len(archived), "pending": 0, "active": 0, "reports": 0}
    pending: list[dict[str, Any]] = []
    for session in sessions:
        if session.id in archived:
            continue
        counts["pending"] += 1
        if session.status == "active":
            counts["active"] += 1
        if session.report:
            counts["reports"] += 1
        events = db.execute(
            select(func.count(StEvent.id), func.max(StEvent.seq)).where(StEvent.session_id == session.id)
        ).one()
        pending.append(
            {
                "session_id": session.id,
                "user_id": session.user_id,
                "pack_key": session.pack_key,
                "pack_revision_id": session.pack_revision_id,
                "status": session.status,
                "events": int(events[0] or 0),
                "tail_seq": int(events[1] or 0),
                "has_report": bool(session.report),
            }
        )
    return {"counts": counts, "pending": pending}


def verify(db: OrmSession, *, limit: int = 0) -> dict[str, Any]:
    """回退边界上的校验：归档数量、会话身份、事件尾序号、回放内容是否与原始事件一致。"""
    rows = db.execute(select(StSessionArchive).order_by(StSessionArchive.session_id)).scalars().all()
    checked = 0
    problems: list[dict[str, Any]] = []
    for row in rows:
        if limit and checked >= limit:
            break
        checked += 1
        session = db.get(StSession, row.session_id)
        if session is None:
            problems.append({"session_id": row.session_id, "problem": "会话不存在"})
            continue
        if session.pack_key != row.pack_key or session.pack_revision_id != row.pack_revision_id:
            problems.append({"session_id": row.session_id, "problem": "身份不匹配"})
        payload = row.payload or {}
        raw_events = (payload.get("raw") or {}).get("events") or []
        tail = max((int(item.get("seq") or 0) for item in raw_events), default=0)
        live = current_seq(db, row.session_id)
        if tail < live:
            problems.append(
                {"session_id": row.session_id, "problem": "归档落后于事件流", "archived_seq": tail, "current_seq": live}
            )
        if not raw_events:
            problems.append({"session_id": row.session_id, "problem": "归档没有原始事件"})
        if bool(session.report) != bool(row.has_report):
            problems.append({"session_id": row.session_id, "problem": "报告标记不一致"})
    return {"archived": len(rows), "checked": checked, "problems": problems}


def seal_active_sessions(db: OrmSession, *, reason: str = CUTOVER_REASON) -> int:
    """把未结束的旧局封存为 `abandoned` + 原因（**不补成学生主动完成**）。"""
    rows = db.execute(select(StSession).where(StSession.status == "active")).scalars().all()
    for session in rows:
        meta = dict(session.meta or {})
        meta["abandoned_reason"] = reason
        meta["read_only"] = True
        session.meta = meta
        session.status = "abandoned"
    return len(rows)


def load_legacy_bundle(path: str) -> dict[int, Any]:
    """读旧实现导出的投影包：`{session_id: {...}}`（键是会话 id，调用方按 `session.id` 取）。"""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    return {int(key): value for key, value in data.items()}
