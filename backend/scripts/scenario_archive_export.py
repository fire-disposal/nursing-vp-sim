"""**在切换前的旧版本上运行**：把旧机制会话的投影导出成 JSON 包，供新版本的归档脚本使用。

为什么需要它：docs/23 §9.1 要求归档用**旧实现**物化（旧版算出来的学生视图与逐回合经历），
而不是让新实现重新解释旧事件。这个脚本只依赖旧版的模块，所以必须在旧代码上跑：

    # 在旧版本（HEAD）的 backend 目录里
    DATABASE_URL=postgresql://... uv run python -m scripts.scenario_archive_export --out /tmp/legacy.json

输出结构（归档脚本用 `--legacy /tmp/legacy.json` 消费）：

    {"<session_id>": {"view": {...}, "report": {...}|null, "turns": [{turn, student, evidence, changes}],
                      "turn_views": [{turn, view}]}}

切换完成后本脚本随旧实现一起删除（docs/23 §9.6）。
"""

from __future__ import annotations

import argparse
import json
import pathlib

from sqlalchemy import select

from core.database import SessionLocal
from models.scenario_training import StEvent, StSession
from modules.scenario_training import pack_loader
from modules.scenario_training.runtime.view import build_view
from modules.scenario_training.runtime.world import fold_event, initial_world


def _turn_views(pack, events, *, session_id: int, status: str, revision_id: int):
    """逐回合前缀视图：每个回合结束时学生看到的样子（旧实现算的）。"""
    world = initial_world(pack)
    out = [{"turn": 0, "view": build_view(pack, world, session_id=session_id, status=status, revision_id=revision_id)}]
    current = 0
    for event in events:
        payload = event.get("payload") or {}
        fold_event(world, event)
        turn = payload.get("turn")
        if turn is not None:
            turn = int(turn)
            if turn > current:
                current = turn
                out.append(
                    {
                        "turn": turn,
                        "view": build_view(pack, world, session_id=session_id, status=status, revision_id=revision_id),
                    }
                )
    return out


def _cue_texts(pack, payload) -> list[str]:
    """`cues_revealed` 事件里可查到的提示原文（查不到的跳过）。"""
    texts = []
    for cue_id in payload.get("cue_ids", []):
        cue = pack.cue(cue_id)
        if cue is not None:
            texts.append(cue.text)
    return texts


def _fact_texts(payload) -> list[str]:
    """`dm_turn` 事件里已声明的事实原文。"""
    return [str(fact["fact"]) for fact in payload.get("facts_declared", []) if fact.get("fact")]


def _collect_turn_notes(pack, events):
    """把逐回合的变化与证据从已提交事件里归集出来（键为回合号）。"""
    changes: dict[int, list[str]] = {}
    evidence: dict[int, list[str]] = {}
    turn = 0
    for event in events:
        kind = event.get("kind")
        payload = event.get("payload") or {}
        if kind == "student_action":
            turn = int(payload.get("turn") or turn + 1)
        elif kind == "effects_applied":
            for item in payload.get("items", []):
                changes.setdefault(turn, []).append(f"{item.get('key')}：{item.get('old')} → {item.get('new')}")
        elif kind == "cues_revealed":
            evidence.setdefault(turn + 1, []).extend(_cue_texts(pack, payload))
        elif kind == "dm_turn":
            evidence.setdefault(turn + 1, []).extend(_fact_texts(payload))
    return changes, evidence


def _key_turns(pack, events):
    """按回合的「你做了什么 / 当时有什么证据 / 有什么变化」（全部来自已提交事件）。

    旧事件流里 `effects_applied` / `cues_revealed` **不带回合号**（旧实现如此），
    因此这里用一个**行进的回合计数**（遇到 `student_action` 就 +1）来归属，不改写任何事件。
    """
    from modules.scenario_training.runtime.world import world_from_events

    world = world_from_events(pack, events)
    changes, evidence = _collect_turn_notes(pack, events)
    rows = []
    for action in world.actions:
        seen = [text for item_turn in range(action.turn) for text in evidence.get(item_turn, [])]
        rows.append(
            {
                "turn": action.turn,
                "student": action.text or action.label(pack),
                "evidence": seen[-3:],
                "changes": changes.get(action.turn, []),
            }
        )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="旧实现投影导出（切换前运行）")
    parser.add_argument("--out", required=True, help="输出 JSON 路径")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        sessions = db.execute(select(StSession).order_by(StSession.id)).scalars().all()
        if args.limit:
            sessions = sessions[: args.limit]
        bundle: dict[str, object] = {}
        for session in sessions:
            rows = (
                db.execute(select(StEvent).where(StEvent.session_id == session.id).order_by(StEvent.seq))
                .scalars()
                .all()
            )
            events = [{"kind": row.kind, "payload": row.payload} for row in rows]
            pack = pack_loader.load_revision(db, session.pack_revision_id)
            views = _turn_views(
                pack,
                events,
                session_id=session.id,
                status=session.status,
                revision_id=session.pack_revision_id,
            )
            bundle[str(session.id)] = {
                "view": views[-1]["view"],
                "turn_views": views,
                "turns": _key_turns(pack, events),
                "report": session.report,
            }
            print(f"exported session {session.id}: {len(events)} events, {len(views)} turn views")
        pathlib.Path(args.out).write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
        print(f"→ {args.out}（{len(bundle)} 个会话）")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
