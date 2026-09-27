from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _RESP_CFG


class TrainingRecordBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    case_id: int
    case_name: str
    user_id: int
    user_display_name: str
    user_student_id: str | None
    score_reviewed: bool = False
    status: str
    scoring_status: str | None = None
    scoring_error: str | None = None
    start_time: datetime
    end_time: datetime | None
    score_total: float | None = None
    #: 成绩来源（ai/review/fallback）与降级标记：列表也要能区分"系统降级"与正常成绩
    score_source: str | None = None
    score_degraded: bool = False
    #: 这条记录是不是学生练习（false=教师/管理员试跑，不进教学统计与作业进度）
    is_student_practice: bool = True
    assignment_id: str | None = None
    assignment_title: str | None = None


class MessageItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    role: str
    content: str
    created_at: datetime


class ScoreReviewItem(BaseModel):
    model_config = _RESP_CFG
    #: 教师复核的**原始条目**（0-raw_scale）；不改条目直接提交时总分不变
    detail_scores: dict[str, Any] | None = None
    total_score: float | None = None
    comment: str | None = None
    reviewed_at: datetime | None = None


class ScoreItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    total_score: float
    detail_scores: dict[str, Any] | None = None
    strengths: list[str] | None = None
    weaknesses: list[str] | None = None
    missed_content: list[str] | None = None
    suggestions: str | None = None
    rubric_version: str | None = None
    model_name: str | None = None
    #: prompt_snapshot 的**形状**版本（1=扁平 / 2=segments）。形状不是内容版本，见 docs/17。
    prompt_schema_version: int | None = None
    review_status: str | None = None
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    review: ScoreReviewItem | None = None
    created_at: datetime
    # Phase 1 契约：raw_total / fallback / 复核写回（成绩口径 = COALESCE(reviewed_total, total_score)）
    raw_total: float | None = None
    mapping_version: int = 0
    fallback: dict[str, Any] | None = None
    reviewed_total: float | None = None
    # ── 本批次契约（docs/19 §4.2/§4.4）──
    #: 原始刻度的逐项评分（条目分/上限/状态/证据引用）；NULL = 历史分，无原始精度
    raw_detail_scores: dict[str, Any] | None = None
    #: 评分溯源（适用原始满分/不适用条目/rubric 与提示词内容身份/等第政策/辅助条件）
    score_meta: dict[str, Any] | None = None
    #: 有效成绩（复核优先）与其来源（ai/review/fallback）——AI 初评、教师复核、系统降级分开可见
    effective_total: float | None = None
    source: str | None = None
    #: 数值分层与（校准前为空的）能力等第 + 政策身份、空反馈说明
    grade: dict[str, Any] | None = None
    feedback_note: str | None = None
    #: 本次评分**不完整**的清单（哪些条目没被判）：成绩照常计，界面如实说明
    incomplete: dict[str, Any] | None = None


class PatientPublicInfo(BaseModel):
    name: str = ""
    age: int = 0
    gender: str = ""


class TrainingRecordDetail(BaseModel):
    model_config = _RESP_CFG
    id: int
    case_id: int
    case_name: str
    user_display_name: str
    status: str
    scoring_status: str | None = None
    scoring_error: str | None = None
    start_time: datetime
    end_time: datetime | None
    time_limit: int = 30
    remaining_seconds: int | None = None
    mode: str = "guided"
    hide_case_info: bool = False
    messages: list[MessageItem]
    score: ScoreItem | None = None
    patient_info: PatientPublicInfo | None = None
    patient_gender: str = ""
    features: dict[str, bool] = Field(default_factory=dict)
    patient_name: str = ""
    patient_age: int = 0
    chief_complaint: str = ""
    case_title: str = ""
    from_assignment: bool = False
    pending_questionnaires: int = 0
    exam_results: list[dict[str, Any]] = Field(default_factory=list)
    nursing_record_sheet: dict[str, Any] | None = None
    #: 提交时间戳：非空 = 内容已冻结并进入评分；空 = 未提交（不进评分证据）
    nursing_record_submitted_at: datetime | None = None
    #: 本次训练的终端原因：user_end / timeout / patient_walkout（None = 仍在进行）
    terminal_reason: str | None = None
    emotion: dict[str, Any] | None = None
    initiative_count: int = 0
    message_correction: dict[str, Any] = Field(default_factory=dict)
    scene: dict[str, Any] | None = None
    required_inquiries: list[str] = Field(default_factory=list)
    #: 引导模式的领域提示（教学蓝图 clue 的领域 + 评估意义）——只给"还需弄清什么、为什么"，
    #: 不给唯一问句；蓝图缺失时为空，前端据此回落既有展示（docs/19 §3.3）
    guided_hints: list[dict[str, Any]] = Field(default_factory=list)
    is_student_practice: bool = True
    #: 服务端解析的 manifest（projection=session）：activities/artifacts/completion/actions
    #: 一律以它为准，前端不得重新推导（docs/15 §四）
    manifest: dict[str, Any] | None = None
    #: 本次记录若为再练习：{kind, purpose, source_record_id, revision_changed}（docs/19 §五）
    practice: dict[str, Any] = Field(default_factory=dict)
    #: 可用的再练习入口（服务端解析；不可用的带 reason，不渲染假入口）
    practice_options: dict[str, Any] = Field(default_factory=dict)
    #: 结果页「关键选择」投影：少量条目 + 证据引用 + 下一次练习原则（W5）
    review_focus: list[dict[str, Any]] = Field(default_factory=list)
    review_focus_note: str = ""
