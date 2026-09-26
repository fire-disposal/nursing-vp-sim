from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from models.auth import User
    from models.training import TrainingRecord


@dataclass
class ToolContext:
    record: TrainingRecord
    case_data: dict
    current_user: User
    db: Session


@dataclass
class ToolResult:
    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    scene: dict[str, Any] | None = None
    error: str = ""


class ToolHandler:
    tool_name: str
    #: 该工具接受的 action 白名单——由 registry.dispatch 统一校验（未知 action → 400）。
    #: 子类必须声明，少了就是"任何 action 都放行"，比漏写检查更危险。
    actions: frozenset[str] = frozenset()

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        raise NotImplementedError


def copy_runtime_state(ctx: ToolContext) -> dict:
    """``record.runtime_state`` 的独立深拷贝，供要改嵌套结构的 handler 使用。

    ``runtime_state`` 是裸 JSONB，没有变更追踪：对已加载值就地改嵌套结构
    （``list.append`` / ``dict.update``）会同时改掉 ORM 里那份“旧值”，
    flush 时新旧内容比较相等 → SQLAlchemy 判定该列未修改，整条 UPDATE 被丢弃，
    查体/测验结果静默不入库。浅拷贝 ``dict(state)`` 挡不住这一点（嵌套对象仍共享）。
    """
    return copy.deepcopy(ctx.record.runtime_state or {})
