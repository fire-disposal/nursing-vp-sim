"""Workflow 注册表与解析器 —— 「这次训练跑哪条闭包」的唯一 owner（docs/15 §二、§九）。

一个事实一个 owner：

| 环节 | owner |
|---|---|
| 这次训练该跑哪条 workflow | **病例 revision**（``case_data.workflow`` 声明） |
| 本次训练固化的 workflow | **训练记录**（``training_records.workflow_id``，NOT NULL、写入后不变） |
| 运行期怎么读 | 一律 :func:`workflow_for_record`（本模块）；不得再 import 具体常量 |

登记规则：新增 workflow = 在 :data:`REGISTRY` 里登记一条**真实**闭包（Activity 白名单 /
完成策略 / 评分与上下文引用 / prompts），而不是恢复按字符串分派。占位、实验能力不得登记。

当前登记两条，产品状态不同（``WorkflowDefinition.runtime_ready``）：

| id | 状态 | 允许 |
|---|---|---|
| ``history_taking`` | 运行期就绪 | 病例编写/发布/目录 + 学生训练（唯一可开始） |
| ``clinical_reasoning`` | 仅作者面就绪（docs/15 §十六） | 病例编写/发布/目录；**训练入口一律拒绝**（:func:`require_startable`） |

「声明随登记收紧」只按**可开始**的 workflow 计数（:func:`startable_workflow_ids`）：只有
一条可开始的闭包时，病例省略声明仍然安全（回落无歧义）；登记第二条**可开始**的 workflow
之后，省略即解析失败 —— 声明从「可选」收紧为「必填」，不会出现「新 workflow 的病例静默
跑成问诊」。不可开始的闭包不能被省略选中（它不可能被开始），但它的病例必须自己声明
（否则内容会被当成问诊病例解析）—— 这条由病例门禁
（``modules.cases.validator``）在发布前强制。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from modules.training.profile import CLINICAL_REASONING, HISTORY_TAKING, WorkflowDefinition

if TYPE_CHECKING:
    from models import Case, CaseRevision, TrainingRecord

#: 病例载荷里声明 workflow 的键（``CaseRevision.content`` 与 ``cases.case_data`` 同形状）。
#: 形状：非空字符串 id。声明质量由病例门禁（``modules/cases/validator``）在发布前检查。
CASE_WORKFLOW_FIELD = "workflow"

#: 唯一登记表：workflow id → 闭包声明。新增 workflow 只能在这里登记。
REGISTRY: dict[str, WorkflowDefinition] = {
    HISTORY_TAKING.id: HISTORY_TAKING,
    CLINICAL_REASONING.id: CLINICAL_REASONING,
}

#: 未声明 workflow 时的回落值 —— 只在「唯一**可开始**的 workflow」时期成立
#: （见 :func:`workflow_for_case_data` 与 :func:`startable_workflow_ids`）。
DEFAULT_WORKFLOW_ID = HISTORY_TAKING.id


def registered_workflow_ids() -> tuple[str, ...]:
    """当前已登记的 workflow id（按登记顺序）——注册表是唯一来源，这里只是视图。"""
    return tuple(REGISTRY)


def startable_workflow_ids() -> tuple[str, ...]:
    """**可开始训练**的 workflow id（``runtime_ready=True``）—— 与登记表分离的视图。

    只有可开始的闭包之间才存在「省略声明该算哪条」的歧义，因此「未声明 = 回落」只在
    这里恰好一条时成立；仅作者面就绪的闭包（编目/发布可以，训练入口拒绝）不参与竞争。
    """
    return tuple(workflow_id for workflow_id, definition in REGISTRY.items() if definition.runtime_ready)


class UnknownWorkflowError(RuntimeError):
    """workflow 无法解析：未登记、未声明（且已登记多个）、或记录缺少冻结值。

    绝不静默回落到某条闭包 —— 静默回落会让第二个 workflow 的病例跑成第一条。
    """

    def __init__(self, workflow_id: str | None, detail: str) -> None:
        self.workflow_id = workflow_id
        self.known = registered_workflow_ids()
        super().__init__(f"{detail}（workflow_id={workflow_id!r}，已登记: {', '.join(self.known) or '无'}）")


class WorkflowNotStartableError(RuntimeError):
    """workflow 已登记但**没有真实运行期入口** —— 拒绝开始训练（docs/15 §十六）。

    这是产品状态冲突，不是参数错误：病例可以存在、可以发布、可以进目录，但在学生工作区
    落地前不能开始。绝不「先建一条空记录再看」——那会留下永远无法渲染、无法评分的训练。
    """

    def __init__(self, workflow: WorkflowDefinition) -> None:
        self.workflow_id = workflow.id
        self.label = workflow.label
        super().__init__(
            f"「{workflow.label}」（{workflow.id}）尚未提供学生工作区与评分，当前不能开始训练；"
            "该病例可用于编写、发布与目录展示"
        )


def get_workflow(workflow_id: str | None) -> WorkflowDefinition:
    """按 id 取已登记的 workflow；未登记即拒绝（不回落、不猜）。"""
    if not isinstance(workflow_id, str) or workflow_id not in REGISTRY:
        raise UnknownWorkflowError(workflow_id, "未知 workflow")
    return REGISTRY[workflow_id]


def require_startable(workflow: WorkflowDefinition) -> WorkflowDefinition:
    """训练入口的**唯一**产品状态门：运行期未就绪即拒绝开始（返回入参便于链式使用）。"""
    if not workflow.runtime_ready:
        raise WorkflowNotStartableError(workflow)
    return workflow


def default_workflow() -> WorkflowDefinition:
    """唯一**可开始**的现行 workflow。

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

    未声明时：只有「唯一**可开始**的 workflow」才允许回落（判别列落地前发布的病例都没有
    声明）。一旦登记了第二条可开始的 workflow，未声明即解析失败 —— 必须显式声明，绝不猜。
    仅作者面就绪的闭包（``runtime_ready=False``）不参与回落：它不可能被开始，被省略选中
    没有意义；它的病例必须自己声明（否则内容会被当成问诊病例 —— 病例门禁在发布前拦）。
    """
    declared = declared_workflow_id(case_data)
    if declared is not None:
        return get_workflow(declared)
    if len(startable_workflow_ids()) > 1:
        raise UnknownWorkflowError(None, "病例未声明 workflow，且已登记多个可开始的 workflow")
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
    此时唯一**可开始**的 workflow 是唯一诚实答案，登记第二条可开始的 workflow 后空值一律拒绝。
    """
    workflow_id = getattr(record, "workflow_id", None)
    if workflow_id:
        return get_workflow(workflow_id)
    if len(startable_workflow_ids()) > 1:
        raise UnknownWorkflowError(None, "训练记录缺少冻结的 workflow_id")
    return REGISTRY[DEFAULT_WORKFLOW_ID]


def record_activity_available(record: TrainingRecord, activity_id: str) -> bool:
    """运行时门 —— 该记录本次训练是否启用了某 Activity（病例声明 + 作业覆盖）。"""
    return workflow_for_record(record).is_enabled(
        getattr(record, "case_snapshot", None) or {},
        activity_id,
        overrides=(getattr(record, "practice_snapshot", None) or {}).get("features"),
    )
