"""NoteCollector 装配 —— workflow 声明的 ``note_sources`` 决定种入哪些来源。

中间件链的装配已随五阶段显式化一并删除（顺序契约见 ``runner.STAGES``）：
本模块只负责"这次训练有哪些上下文来源"，不负责"阶段怎么排"。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from modules.training.profile import WorkflowDefinition

log = logging.getLogger(__name__)


def build_note_collector(workflow: WorkflowDefinition | None = None) -> Any:
    """按 ``workflow`` 的 ``note_sources`` 组装 NoteCollector。

    运行期调用方传 ``workflows.workflow_for_record(record)``；缺省取唯一已登记的 workflow
    （无记录上下文的装配点/测试）。``training_type`` 字符串分派已退场（docs/15 §九），
    不要在这里加"看起来能分派"的未用参数。
    """
    from modules.training.patient_ai.note_collector import NoteCollector
    from modules.training.workflows import default_workflow

    collected_from = workflow or default_workflow()
    collector = NoteCollector()
    for src_cls in collected_from.note_sources:
        collector.add(src_cls())
    return collector
