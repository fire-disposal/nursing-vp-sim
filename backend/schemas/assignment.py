from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from core.statuses import TrainingMode
from schemas.common import _REQ_CFG, _RESP_CFG

# 作业可配置的训练模式白名单。blind_box（随机抽取）仅限自主端点，作业不可配；
# 作业隐藏病例信息用独立开关 behavior.hide_case_info（教师指定病例，不做随机抽取）。
_ASSIGNMENT_MODES = {TrainingMode.GUIDED.value, TrainingMode.ASSESSMENT.value}


def _check_behavior(v: dict | None) -> dict | None:
    """behavior 字段校验：mode 必须在作业白名单；hide_case_info 必须是布尔。"""
    if not v:
        return v
    mode = v.get("mode")
    if mode is not None and mode not in _ASSIGNMENT_MODES:
        raise ValueError(f"behavior.mode 必须是 {'/'.join(sorted(_ASSIGNMENT_MODES))}，收到: {mode!r}")
    hide = v.get("hide_case_info")
    if hide is not None and not isinstance(hide, bool):
        raise ValueError("behavior.hide_case_info 必须是布尔值")
    return v


class AssignmentAudience(BaseModel):
    """作业受众（发布/更新时提交）。

    ``class`` = 发布时全班学生成员快照；``selected`` = 发布时显式名单（必须显式给出
    ``user_ids``）。两种模式都在发布时固化到受众快照，之后班级成员变动不再影响它。
    """

    model_config = _REQ_CFG
    mode: Literal["class", "selected"] = "class"
    user_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "AssignmentAudience":
        if len(set(self.user_ids)) != len(self.user_ids):
            raise ValueError("audience.user_ids 不能包含重复用户")
        if any(uid <= 0 for uid in self.user_ids):
            raise ValueError("audience.user_ids 必须是正整数")
        if self.mode == "selected" and not self.user_ids:
            raise ValueError("audience.mode=selected 必须提供 user_ids")
        if self.mode == "class" and self.user_ids:
            raise ValueError("audience.mode=class 不接受 user_ids（全班由发布时成员快照决定）")
        return self


class AssignmentCreateRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    class_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict = Field(default_factory=dict)
    audience: AssignmentAudience = Field(default_factory=AssignmentAudience)
    start_time: datetime
    end_time: datetime
    max_attempts: int | None = Field(default=1, description="最大尝试次数；0 或 None 为不限制")

    @field_validator("behavior")
    @classmethod
    def _validate_behavior(cls, v: dict) -> dict | None:
        return _check_behavior(v)


class AssignmentUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int | None = None
    class_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    features: dict[str, bool] | None = None
    behavior: dict | None = None
    audience: AssignmentAudience | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_closed: bool | None = None
    max_attempts: int | None = Field(
        default=None,
        description="最大尝试次数；显式 null = 不限制，请求未携带该键 = 不修改",
    )

    @field_validator("behavior")
    @classmethod
    def _validate_behavior(cls, v: dict | None) -> dict | None:
        return _check_behavior(v)


class AssignmentListItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    case_name: str = ""
    class_name: str = ""
    #: 院校归属（作业班级的院校）：平台角色「全部院校」视图下逐行认院校
    school_id: int | None = None
    school_name: str | None = None
    teacher_name: str = ""
    start_time: datetime
    end_time: datetime
    audience_mode: str = "class"
    student_count: int = 0
    completed_count: int = 0
    created_at: datetime
    is_closed: bool = False
    max_attempts: int | None = None


class AssignmentStudentItem(BaseModel):
    model_config = _RESP_CFG
    user_id: int
    display_name: str
    student_id: str | None = None
    record_id: int | None = None
    status: str = "not_started"
    score_total: float | None = None
    scoring_status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_overdue: bool = False
    attempt_count: int = 0


class AssignmentDetail(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    description: str | None = None
    case_id: int
    case_name: str = ""
    class_id: int
    class_name: str = ""
    features: dict = Field(default_factory=dict)
    behavior: dict = Field(default_factory=dict)
    audience_mode: str = "class"
    recipient_ids: list[int] = Field(default_factory=list, description="发布时固化的受众快照")
    start_time: datetime
    end_time: datetime
    created_at: datetime
    updated_at: datetime
    student_count: int = 0
    completed_count: int = 0
    scored_count: int = 0
    avg_score: float | None = None
    max_score: float | None = None
    min_score: float | None = None
    completion_rate: float = 0.0
    students: list["AssignmentStudentItem"] = Field(default_factory=list)
    max_attempts: int | None = None


class StudentAssignmentItem(BaseModel):
    """学生作业卡片 —— status 取值见 core.statuses.AssignmentProgressStatus。

    与教师端 ``AssignmentStudentItem`` 同一推导（modules.assignments.progress），
    状态词表不再混用训练记录状态（pending → not_started）。
    """

    model_config = _RESP_CFG
    id: str
    title: str
    case_name: str
    #: 为真时 case_name 为空，前端显示“隐藏病例”，不得从病例目录反查
    hide_case_info: bool
    start_time: datetime
    end_time: datetime
    status: str = "not_started"
    record_id: int | None = None
    score_total: float | None = None
    scoring_status: str | None = None
    is_overdue: bool = False
    max_attempts: int | None = None
    attempt_count: int = 0


class StudentAssignmentAttempt(BaseModel):
    """学生本人某次作业尝试 —— 只披露学生自己会用来复盘/续练的字段。

    刻意不含病例名以外的教学内容、诊断、评分明细：尝试列表是「我考了几次」，
    不是成绩单（分数只有在 ``scoring_status == completed`` 时才有值）。
    """

    model_config = _RESP_CFG
    record_id: int
    status: str
    scoring_status: str | None = None
    score_total: float | None = None
    is_overdue: bool = False
    start_time: datetime | None = None
    end_time: datetime | None = None


class StudentRequiredActivity(BaseModel):
    """学生可见的「本次要做什么」—— 只含公开标签。

    标签来源是 Activity 登记表（``ACTIVITY_BINDINGS[*].label``），不新建映射表；
    刻意**不含** config / evidence_kind / 内部判定条件。
    """

    model_config = _RESP_CFG
    id: str
    label: str


class StudentRequiredArtifact(BaseModel):
    """学生可见的必交产物 —— 只含可公开的标签与 id。

    不含提交判定细节、评分细则或病例 hidden_info。
    """

    model_config = _RESP_CFG
    kind: str
    label: str


class StudentAssignmentDetail(BaseModel):
    """学生作业详情 —— 单页展示作业要求 + 本人全部尝试所需的全部字段。

    与学生列表卡片共用同一套进度推导（``modules.assignments.progress``）；
    额外给出 ``lifecycle``（active/ended/closed）以便页面区分「还能开始/只能看历史」。
    """

    model_config = _RESP_CFG
    id: str
    title: str
    description: str | None = None
    #: 隐藏病例时为 None，避免学生拿编号去病例目录反查
    case_id: int | None
    #: ``behavior.hide_case_info`` 为真时不披露病例名（与训练入口的脱敏口径一致）
    case_name: str
    hide_case_info: bool
    class_id: int
    class_name: str = ""
    teacher_name: str = ""
    start_time: datetime
    end_time: datetime
    #: active | ended | closed（见 core.statuses.AssignmentLifecycle）
    lifecycle: str = "active"
    #: not_started | in_progress | completed | overdue | closed
    status: str = "not_started"
    #: 作业配置的训练模式（guided/assessment），空串 = 未配置
    mode: str = ""
    #: 0 / None = 不限制
    max_attempts: int | None = None
    attempt_count: int = 0
    #: 还能开始几次；None = 不限制；0 = 已用完
    remaining_attempts: int | None
    #: 当前可续练的训练记录（仅 status=in_progress 时给出）
    record_id: int | None
    #: 本人该作业的全部尝试，新→旧；响应始终携带，空数组表示无尝试
    attempts: list[StudentAssignmentAttempt]
    #: 本次训练的预计时限（分钟）—— 与开始训练时的倒计时同一口径
    time_limit_minutes: int | None = None
    #: 学生需要在本病例里完成的公开操作（标签来自 Activity 登记表），只含展示标签
    required_activities: list[StudentRequiredActivity]
    #: 交卷前必须提交的产物（``completion.required_artifacts``）；为空 = 无额外必交
    required_artifacts: list[StudentRequiredArtifact]
