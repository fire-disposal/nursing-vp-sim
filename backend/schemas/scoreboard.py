"""成绩管理 — 学生平均成绩排名 / 分层 / 进步幅度 的数据契约。

评分总分经评分流水线统一换算为 0-100 分（`_convert_to_100_scale`），
好/中/差分层沿用系统既有惯例（TeachingDashboard 的 SCORE_COLOR）：
- good   ≥ 85
- medium 60 ≤ score < 85
- poor   < 60
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
    """分层人数：{"good": n, "medium": n, "poor": n}。"""
    thresholds: dict[str, float] = Field(default_factory=dict)
    """分层阈值：{"good_min": 85.0, "poor_max": 60.0}。"""


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
