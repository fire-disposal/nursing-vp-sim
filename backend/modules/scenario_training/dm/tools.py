"""DM 的**只读环境工具**与便条：先看后做（docs/21 §三/§四）。

工具是**平台实现**的确定性函数（不是让 DM 自由发挥）：读的都是 pack 声明与事件流已推导出的世界，
因此"读一眼"不引入新事实、也不泄底。每一步都落一条 `dm_step` 事件（教师回放可见、学生不可见）。

`note.write` 是唯一的写操作，它只写 DM 的**草稿纸**（`World.dm_notes`，学生看不到），
用来在长会话里维持"它在想什么"——它不是状态改动，不参与判读。
"""

from __future__ import annotations

from typing import Any

from ..runtime.world import World
from ..schema import ScenarioPack

MAX_HISTORY = 20  # `history.lastN` 的上限：别把整场会话塞回提示词
MAX_NOTE = 200  # `note.write` 的单条上限：草稿纸不是文章
NOTE_KEEP = 8  # 给回提示词的便条条数上限（最近 N 条）

# 工具名录（提示词与守卫共用这一份）：名字 → 一句话说明
TOOL_SPECS: tuple[tuple[str, str], ...] = (
    ("world.state()", "这一刻已登记的状态键与取值、当前回合数"),
    ("actor.knowledge(who)", "某个在场者该知道什么（知识边界快照；who = 角色 id）"),
    ("history.lastN(n)", f"最近 n 条回合记录（n ≤ {MAX_HISTORY}）"),
    ("note.write(text)", f"写一张只给你自己看的便条（≤{MAX_NOTE} 字；学生看不到，教师回放可见）"),
)
TOOL_NAMES = frozenset(name.split("(")[0] for name, _ in TOOL_SPECS)
NOTE_TOOL = "note.write"


def _world_state(world: World) -> dict[str, Any]:
    return {"turn": world.turn, "state": dict(world.state), "fired": list(world.fired)}


def _actor_knowledge(pack: ScenarioPack, world: World, args: dict[str, Any]) -> dict[str, Any]:
    who = str(args.get("who") or args.get("actor") or args.get("id") or "").strip()
    actor = pack.actor(who)
    if actor is None:
        return {"error": f"unknown_actor:{who}", "actors": [item.id for item in pack.actors]}
    own = {key.split(".", 1)[1]: value for key, value in world.state.items() if key.startswith(f"{actor.id}.")}
    return {
        "id": actor.id,
        "role": actor.role,
        "presence": actor.presence.value,
        "knows": actor.knowledge,
        "style": actor.style,
        "goals": list(actor.goals),
        "state": own,
    }


def _history(pack: ScenarioPack, world: World, args: dict[str, Any]) -> dict[str, Any]:
    raw = args.get("n", 8)
    n = int(raw) if isinstance(raw, (int, float)) and not isinstance(raw, bool) else 8
    n = max(1, min(n, MAX_HISTORY))
    return {"last": n, "transcript": world.transcript(pack, limit=n)}


def _note_write(world: World, args: dict[str, Any]) -> dict[str, Any]:
    text = " ".join(str(args.get("text") or "").split())[:MAX_NOTE]
    if not text:
        return {"error": "empty_note"}
    world.dm_notes.append(text)
    return {"saved": text}


def run_tool(pack: ScenarioPack, world: World, tool: str, args: dict[str, Any]) -> dict[str, Any]:
    """执行一次工具调用（纯函数式，除 `note.write` 写草稿纸外无副作用）。未知工具返回 error。"""
    if tool == NOTE_TOOL:
        return _note_write(world, args)
    if tool == "world.state":
        return _world_state(world)
    if tool == "actor.knowledge":
        return _actor_knowledge(pack, world, args)
    if tool == "history.lastN":
        return _history(pack, world, args)
    return {"error": f"unknown_tool:{tool}", "tools": sorted(TOOL_NAMES)}


def summarize(tool: str, result: dict[str, Any]) -> str:
    """给事件用的**短摘要**（事件不是日志转储：只留看得出做过什么的那几个数）。"""
    if "error" in result:
        return f"error={result['error']}"
    if tool == NOTE_TOOL:
        return f"note={len(str(result.get('saved', '')))} 字"
    if tool == "world.state":
        return f"turn={result.get('turn')} state={len(result.get('state', {}))} 项"
    if tool == "actor.knowledge":
        return f"actor={result.get('id')}"
    if tool == "history.lastN":
        return f"last={result.get('last')} 行={len(str(result.get('transcript', '')).splitlines())}"
    return f"keys={sorted(result)[:4]}"


def notes_block(world: World) -> list[str]:
    """回给提示词的便条（最近 `NOTE_KEEP` 条）。"""
    return list(world.dm_notes[-NOTE_KEEP:])
