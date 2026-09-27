"""成绩管理 — 学生平均成绩排名 / 分层 / 进步幅度 的数据契约。

评分总分经评分流水线统一换算为 0-100 分（`_convert_to_100_scale`）。这里的 good/medium/poor
是**数值分层**（阈值由 ``modules/training/scoring/grade_policy`` 唯一给出），不是经校准的
能力等第：每个响应都带 ``policy`` 块，说明政策身份与「能力等第当前是否可用」
（docs/19 §4.2 第 8/9 条）。
"""

from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _RESP_CFG

# 排名分层（与前端 SCORE_COLOR 及好中差语义一致）
TIER_GOOD = "good"
TIER_MEDIUM = "medium"
TIER_POOR = "poor"
TIER_NONE = "none"

# 进步幅度方向
TREND_UP = "up"
TREND_FLAT = "flat"
TREND_DOWN = "down"
TREND_NONE = "none"


class ScoreboardSummary(BaseModel):
    """当前筛选范围的整体概览（基于全量学生，不受分页影响）。"""

    model_config = _RESP_CFG

    record_count: int = 0
    """计入统计的有效训练次数（completed + 已评分）。"""
    student_count: int = 0
    """有成绩并入榜的学生数。"""
    case_count: int = 0
    """覆盖的病例数（0 表示无数据）。"""
    avg_score: float | None = None
    """学生平均分的均值（保留 1 位）。"""
    avg_duration_seconds: int | None = None
    """学生平均用时的均值（秒，向上取整）。"""
    tier_counts: dict[str, int] = Field(default_factory=dict)
    """数值分层人数：{"good": n, "medium": n, "poor": n}（不是能力等第人数）。"""
    thresholds: dict[str, float] = Field(default_factory=dict)
    """数值分层阈值：{"good_min": 85.0, "poor_max": 60.0}（来源：等第政策）。"""
    policy: dict = Field(default_factory=dict)
    """等第政策身份与可用性：{id, version, calibrated, capability_available, capability_label, ...}。"""
    comparability: dict = Field(default_factory=dict)
    """可比性块：{mixed, single_group, identity_unknown_count, groups:[{label,count,key}]}。

    不同原始满分/辅助条件/规则身份的记录不构成可比组，聚合只能作为数值描述。"""


class ScoreboardRankingItem(BaseModel):
    """单个学生在所选范围内的排名条目。"""

    model_config = _RESP_CFG

    rank: int = 0
    user_id: int
    display_name: str
    student_id: str | None = None
    class_name: str = ""
    avg_score: float | None = None
    """学生平均分（保留 1 位）。"""
    best_score: float | None = None
    """单次最高分。"""
    avg_duration_seconds: int | None = None
    """平均训练用时（秒）。"""
    training_count: int = 0
    """计入的训练次数。"""
    case_count: int = 0
    """覆盖的病例数。"""
    tier: str = TIER_NONE
    """好中差分档：good | medium | poor | none。"""
    progress_delta: float | None = None
    """进步幅度：后半程均分 − 前半程均分（分前后两半比较）。"""
    progress_trend: str = TREND_NONE
    """up | flat | down | none。"""


class ScoreboardRankingResponse(BaseModel):
    model_config = _RESP_CFG

    summary: ScoreboardSummary
    items: list[ScoreboardRankingItem] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 0
    policy: dict = Field(default_factory=dict)
    """等第政策身份与可用性（与 summary.policy 同一份）。"""


class StudentTrendRecord(BaseModel):
    """学生单次训练的成绩点（按时间升序，供趋势图直接绘制）。"""

    model_config = _RESP_CFG

    record_id: int
    case_id: int
    case_name: str = ""
    assignment_id: str | None = None
    assignment_title: str | None = None
    score: float
    duration_seconds: int = 0
    start_time: datetime
    end_time: datetime | None = None
    comparability_label: str = ""
    """该次训练所属可比组标签；不同标签的点不能连成一条"进步"曲线。"""


class StudentTrendResponse(BaseModel):
    """单个学生的成绩趋势（图表数据源）。"""

    model_config = _RESP_CFG

    user_id: int
    display_name: str
    student_id: str | None = None
    class_name: str = ""
    training_count: int = 0
    total_duration_seconds: int = 0
    avg_score: float | None = None
    best_score: float | None = None
    first_score: float | None = None
    latest_score: float | None = None
    progress_delta: float | None = None
    progress_trend: str = TREND_NONE
    records: list[StudentTrendRecord] = Field(default_factory=list)
    policy: dict = Field(default_factory=dict)
    """等第政策身份与可用性（数值趋势 ≠ 能力进步结论，见 docs/19 §4.4）。"""
    comparability: dict = Field(default_factory=dict)
    """可比性块；``single_group=False`` 时 ``progress_delta/progress_trend`` 不计算跨组进步。"""
