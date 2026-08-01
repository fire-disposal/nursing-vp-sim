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
    return value if value in TrainingMode else TrainingMode.GUIDED.value
