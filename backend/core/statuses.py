"""状态机常量 — 训练记录/评分/LLM 调用的状态值唯一真值。

使用 ``StrEnum``：成员是 ``str`` 的子类，与裸字符串比较、JSON 序列化、
SQLAlchemy 绑定参数均兼容，可安全替换历史散落的字面量。
"""

from enum import StrEnum


class TrainingStatus(StrEnum):
    """TrainingRecord.status — 训练会话的总体状态。"""

    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    DISCARDED = "discarded"
    ABANDONED = "abandoned"
    FAILED = "failed"


class ScoringStatus(StrEnum):
    """TrainingRecord.scoring_status — 评分流水线状态。"""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class LLMCallStatus(StrEnum):
    """LLMCallLog.status — LLM 调用结果状态（DB 写入值）。

    消费端全部以 ``== \"success\"`` / ``!= \"success\"`` 二元判断；
    ``\"error\"`` 仅作为内存 metrics 标签出现，不落库，故不在此列。
    """

    SUCCESS = "success"
    FAILED = "failed"


class TrainingMode(StrEnum):
    """训练模式 — 训练进行方式，三值互斥。

    - ``GUIDED``：引导模式，显示标题/引导内容（自主选病例与作业默认）
    - ``ASSESSMENT``：考核模式，隐藏解读（作业 behavior.mode 可配置）
    - ``BLIND_BOX``：盲盒模式，隐藏标题与引导，病例随机抽取（仅自主触发，
      作业不可配置，见 schemas/assignment.py 白名单）

    读取端（session / detail 视图）对非法值一律回退 ``GUIDED``，
    防历史脏数据静默透传。
    """

    GUIDED = "guided"
    ASSESSMENT = "assessment"
    BLIND_BOX = "blind_box"


def normalize_training_mode(value: object) -> str:
    """白名单规范化；非法或缺失值一律回退 guided。"""
    if isinstance(value, str) and value in TrainingMode:
        return value
    return TrainingMode.GUIDED.value


class AssignmentProgressStatus(StrEnum):
    """作业进度状态 — 学生端/教师端读侧共用的唯一词表。

    ``abandoned`` / ``discarded`` 记录不构成一次作业进度（既不消耗尝试次数，
    也不参与代表记录推导），故不在此列；推导见 ``modules.assignments.progress``。
    """

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    OVERDUE = "overdue"
    CLOSED = "closed"


class AssignmentLifecycle(StrEnum):
    """作业生命周期 — 由 ``is_closed`` 与 ``end_time`` 推导的唯一口径。

    ``CLOSED``（教师手动关闭）优先于 ``ENDED``（超过截止时间）；三处读侧
    （教师列表过滤/学生端状态/开始门控）共用 ``modules.assignments.progress.effective_status``。
    """

    ACTIVE = "active"
    ENDED = "ended"
    CLOSED = "closed"


class QuestionnaireTrigger(StrEnum):
    """CaseQuestionnaire.trigger_event — 问卷触发时点（唯一词表）。

    ``BEFORE_TRAINING``：训练入口触发（前端 TrainingEntry）；
    ``AFTER_SCORING``：教师端评分/复核完成后触发（前端 TeacherRecordDetail）。
    历史后台默认值 ``after_training`` 无任何触发点，已废弃（新写入一律被枚举拒绝）。
    """

    BEFORE_TRAINING = "before_training"
    AFTER_SCORING = "after_scoring"


def normalize_questionnaire_trigger(value: object) -> str:
    """白名单规范化；非法或缺失值（含历史 ``after_training``）一律回退 before_training。"""
    if isinstance(value, str) and value in QuestionnaireTrigger:
        return value
    return QuestionnaireTrigger.BEFORE_TRAINING.value


class SimulationStatus(StrEnum):
    """SimulationSession.state.case_status — 临床推理模拟会话的结局状态（唯一真值）。

    真值只存于 ``state`` JSONB（``build_snapshot`` / 前端读取的就是它）；
    曾与之并存的 ``simulation_sessions.status`` 列已删除，避免双写漂移。
    """

    ACTIVE = "ACTIVE"
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"
