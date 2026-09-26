"""Workflow 注册表与解析器 —— 「这次训练跑哪条闭包」的唯一 owner（docs/15 §二、§九）。

一个事实一个 owner：

| 环节 | owner |
|---|---|
| 这次训练该跑哪条 workflow | **病例 revision**（``case_data.workflow`` 声明） |
| 本次训练固化的 workflow | **训练记录**（``training_records.workflow_id``，NOT NULL、写入后不变） |
| 运行期怎么读 | 一律 :func:`workflow_for_record`（本模块）；不得再 import 具体常量 |

登记规则（本切片只登记 ``history_taking``）：新增 workflow = 在 :data:`REGISTRY` 里登记
一条**真实**闭包（Activity 白名单 / 完成策略 / 评分与上下文引用 / prompts），而不是恢复
按字符串分派。登记第二个 workflow 的那一刻，病例 revision 未声明 workflow 立刻变成解析
失败 —— 声明从「可选」自动收紧为「必填」，因此不会出现「新 workflow 的病例静默跑成问诊」。

占位、实验、不可达的 workflow 不得登记（docs/16 §三：未接入生产闭环的入口不进生产导航）。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from modules.training.profile import HISTORY_TAKING, WorkflowDefinition

if TYPE_CHECKING:
    from models import Case, CaseRevision, TrainingRecord

#: 病例载荷里声明 workflow 的键（``CaseRevision.content`` 与 ``cases.case_data`` 同形状）。
#: 形状：非空字符串 id。声明质量由病例门禁（``modules/cases/validator``）在发布前检查。
CASE_WORKFLOW_FIELD = "workflow"

#: 唯一登记表：workflow id → 闭包声明。新增 workflow 只能在这里登记。
REGISTRY: dict[str, WorkflowDefinition] = {
    HISTORY_TAKING.id: HISTORY_TAKING,
}

#: 未声明 workflow 时的回落值 —— 只在「唯一现行 workflow」时期成立（见 :func:`workflow_for_case_data`）
DEFAULT_WORKFLOW_ID = HISTORY_TAKING.id


def registered_workflow_ids() -> tuple[str, ...]:
    """当前已登记的 workflow id（按登记顺序）——注册表是唯一来源，这里只是视图。"""
    return tuple(REGISTRY)


class UnknownWorkflowError(RuntimeError):
    """workflow 无法解析：未登记、未声明（且已登记多个）、或记录缺少冻结值。

    绝不静默回落到某条闭包 —— 静默回落会让第二个 workflow 的病例跑成第一条。
    """

    def __init__(self, workflow_id: str | None, detail: str) -> None:
        self.workflow_id = workflow_id
        self.known = registered_workflow_ids()
        super().__init__(f"{detail}（workflow_id={workflow_id!r}，已登记: {', '.join(self.known) or '无'}）")


def get_workflow(workflow_id: str | None) -> WorkflowDefinition:
    """按 id 取已登记的 workflow；未登记即拒绝（不回落、不猜）。"""
    if not isinstance(workflow_id, str) or workflow_id not in REGISTRY:
        raise UnknownWorkflowError(workflow_id, "未知 workflow")
    return REGISTRY[workflow_id]


def default_workflow() -> WorkflowDefinition:
    """唯一现行 workflow。

    只服务没有记录上下文的装配点（如 pipeline 构建的缺省值）——**不**是运行期分派：
    带记录/带 revision 的路径一律走 :func:`workflow_for_record` / :func:`workflow_for_case_revision`。
    """
    return REGISTRY[DEFAULT_WORKFLOW_ID]


def declared_workflow_id(case_data: Mapping[str, Any] | None) -> str | None:
    """病例载荷声明的 workflow id；未声明或形状非法返回 ``None``（形状问题由病例门禁报出）。"""
    if not isinstance(case_data, Mapping):
        return None
    raw = case_data.get(CASE_WORKFLOW_FIELD)
    if not isinstance(raw, str):
        return None
    return raw.strip() or None


def workflow_for_case_data(case_data: Mapping[str, Any] | None) -> WorkflowDefinition:
    """病例载荷 → workflow（病例是数据，不是分派开关）。

    未声明时：只有「唯一现行 workflow」才允许回落（判别列落地前发布的病例都没有声明）。
    一旦登记了第二个 workflow，未声明即解析失败 —— 必须显式声明，绝不猜。
    """
    declared = declared_workflow_id(case_data)
    if declared is not None:
        return get_workflow(declared)
    if len(REGISTRY) > 1:
        raise UnknownWorkflowError(None, "病例未声明 workflow，且已登记多个 workflow")
    return REGISTRY[DEFAULT_WORKFLOW_ID]


def workflow_for_case_revision(revision: CaseRevision) -> WorkflowDefinition:
    """按**钉住的**病例 revision 解析 —— 训练开始时的唯一入口（docs/15 §六）。"""
    return workflow_for_case_data(getattr(revision, "content", None))


def workflow_for_case(case: Case) -> WorkflowDefinition:
    """按病例 current revision 解析（目录/教师投影等只读展示）。

    revision 与工作副本在已发布病例上必须一致（``modules/cases/revisions``）；未发布病例
    没有 revision，落到工作副本才不至于让 draft 病例无 workflow 可展示。
    """
    revision = getattr(case, "current_revision", None)
    content = getattr(revision, "content", None) if revision is not None else None
    if content is None:
        content = getattr(case, "case_data", None)
    return workflow_for_case_data(content)


def workflow_for_record(record: TrainingRecord) -> WorkflowDefinition:
    """训练记录**冻结**的 workflow —— 所有运行期读取的唯一入口。

    ``workflow_id`` 为空只可能来自未 flush 的瞬态对象（测试替身）；持久化行是 NOT NULL。
    此时唯一现行 workflow 是唯一诚实答案，登记第二个 workflow 后空值一律拒绝。
    """
    workflow_id = getattr(record, "workflow_id", None)
    if workflow_id:
        return get_workflow(workflow_id)
    if len(REGISTRY) > 1:
        raise UnknownWorkflowError(None, "训练记录缺少冻结的 workflow_id")
    return REGISTRY[DEFAULT_WORKFLOW_ID]


def record_activity_available(record: TrainingRecord, activity_id: str) -> bool:
    """运行时门 —— 该记录本次训练是否启用了某 Activity（病例声明 + 作业覆盖）。"""
    return workflow_for_record(record).is_enabled(
        getattr(record, "case_snapshot", None) or {},
        activity_id,
        overrides=(getattr(record, "practice_snapshot", None) or {}).get("features"),
    )
