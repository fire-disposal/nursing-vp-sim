"""成绩管理 — 学生平均成绩排名 / 分层 / 进步幅度 的数据契约。

评分总分经评分流水线统一换算为 0-100 分（`_convert_to_100_scale`）。这里的 good/medium/poor
是**数值分层**（阈值由 ``modules/training/scoring/grade_policy`` 唯一给出），不是经校准的
能力等第：每个响应都带 ``policy`` 块，说明政策身份与「能力等第当前是否可用」。
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
    #: 院校归属：平台角色「全部院校」视图下逐行认院校
    school_id: int | None = None
    school_name: str | None = None
    avg_score: float | None = None
    """学生平均分（保留 1 位）。"""
    best_score: float | None = None
    """单次最高分。"""
    total_score: float | None = None
    """该范围内有效成绩的总分（``COALESCE(复核分, AI 分)`` 求和，排除兜底分）。"""
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
    """等第政策身份与可用性（数值趋势 ≠ 能力进步结论）。"""
    comparability: dict = Field(default_factory=dict)
    """可比性块；``single_group=False`` 时 ``progress_delta/progress_trend`` 不计算跨组进步。"""


# ── 学生学习档案（教师视角的单学生页面数据源）──
#
# 档案只投影"这个人和他的训练/作业"，不投影账号面：用户名之外的邮箱、微信、
# 登录锁定、权限/视角授予一律不出现 —— 教学侧不需要，也不需要为此多要一道权限。


class StudentProfileClass(BaseModel):
    """学生所属班级（报名册口径：``member_role='student'`` 的成员关系）。"""

    model_config = _RESP_CFG

    id: int
    name: str
    cohort_label: str = ""
    school_id: int = 0
    school_name: str = ""


class StudentProfileIdentity(BaseModel):
    """档案头部身份块 —— 只含教师工作所需的展示字段。"""

    model_config = _RESP_CFG

    user_id: int
    display_name: str
    student_id: str | None = None
    username: str
    classes: list[StudentProfileClass]
    """该生在本作用域内的班级（按 class_id 升序，稳定可复现）。"""


class StudentProfileAssignmentItem(BaseModel):
    """该生在某次作业里的进度。

    口径与教师端作业详情、学生端作业列表**同一份**推导
    （``modules.assignments.progress``）：代表记录 = 作业进度与分数的唯一来源，
    尝试次数排除进行中/已放弃/已丢弃。
    """

    model_config = _RESP_CFG

    assignment_id: str
    title: str
    case_id: int
    case_name: str = ""
    class_id: int
    class_name: str = ""
    start_time: datetime
    end_time: datetime
    lifecycle: str = "active"
    """active | ended | closed —— 作业生命周期（``is_closed`` 优先于 ``end_time``）。"""
    status: str = "not_started"
    """not_started | in_progress | completed | overdue | closed —— 该生在本作业的进度。"""
    attempt_count: int = 0
    max_attempts: int | None = None
    record_id: int | None = None
    """代表记录 id（进教师记录详情用）；未开始时为空。"""
    score_total: float | None = None
    scoring_status: str | None = None
    is_overdue: bool = False


class StudentProfileTrainingItem(BaseModel):
    """一条训练记录（档案「训练记录」页签的列表行，字段与教师记录列表同源）。"""

    model_config = _RESP_CFG

    record_id: int
    case_id: int
    case_name: str = ""
    assignment_id: str | None = None
    assignment_title: str | None = None
    status: str
    scoring_status: str | None = None
    score_reviewed: bool = False
    score_total: float | None = None
    """展示成绩（复核分优先、排除兜底分）；未评分/兜底分为空。"""
    score_source: str | None = None
    """ai | review | fallback。"""
    score_degraded: bool = False
    start_time: datetime
    end_time: datetime | None = None
    duration_seconds: int = 0
    is_student_practice: bool = True
    is_overdue: bool = False


class StudentProfileTrainingSummary(BaseModel):
    """训练记录页签的集合统计（与列表同一套筛选，故与 ``training_total`` 同源）。"""

    model_config = _RESP_CFG

    completed: int = 0
    scored: int = 0
    avg_score: float | None = None
    avg_duration_seconds: int | None = None


class StudentLearningProfileResponse(BaseModel):
    """教师视角的单个学生学习档案。

    三块数据各有唯一的既有口径，本响应只做聚合、不新造判断：

    - ``trend``：与 ``GET /scoreboard/students/{id}/trend`` **同一份**服务与筛选范围，
      可比性/进步幅度由服务端判定，前端不复制；
    - ``assignments``：与教师端作业详情同一份进度推导；
    - ``training``：与教师记录列表同一份成绩口径（复核分优先、兜底分排除）。
    """

    model_config = _RESP_CFG

    student: StudentProfileIdentity
    trend: StudentTrendResponse
    assignments: list[StudentProfileAssignmentItem]
    training: list[StudentProfileTrainingItem]
    training_total: int = 0
    training_summary: StudentProfileTrainingSummary
    training_offset: int = 0
    training_limit: int = 0
