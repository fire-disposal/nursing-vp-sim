from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

_GENDER = Field(default=None, pattern=r"^(男|女)?$")

MemberRole = Literal["student", "teacher"]


class UserMembershipItem(BaseModel):
    """用户所属班级（单用户多班级：一个用户可有多条）。"""

    model_config = _RESP_CFG
    class_id: int | None = None
    class_name: str | None = None
    cohort_label: str | None = None
    member_role: str = "student"
    joined_at: datetime | None = None


class UserMembershipUpdate(BaseModel):
    """用户编辑里的成员关系项 —— 提供 ``memberships`` 即为全量替换。"""

    model_config = _REQ_CFG
    class_id: int = Field(gt=0)
    member_role: MemberRole = "student"


class UserBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    username: str
    role: str
    role_display_name: str
    #: 院校归属。None = 平台角色（跨院校可见，例如 super_admin）。
    school_id: int | None = None
    school_name: str | None = None
    #: 院校品牌（品牌只影响观感，不参与隔离）：
    #: 主题色调色板键、是否有院徽、院徽版本号（前端 `<img src=...?v=...>` 缓存用）。
    school_theme_color: str | None = None
    school_has_logo: bool = False
    school_logo_updated_at: datetime | None = None
    display_name: str
    student_id: str | None
    gender: str | None = None
    avatar: str | None = None
    memberships: list[UserMembershipItem] = Field(default_factory=list)
    created_at: datetime
    is_active: bool = True
    # 仅 /auth/me 填充（其它列表接口不查权限表，留空）：前端据此在每次加载时刷新侧栏门禁，
    # 否则降权/升权后前端最长 24h 仍按旧权限渲染（2026-09-26 审计 RB-4）。
    permissions: list[str] = Field(default_factory=list)


class UserProfileUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    display_name: str | None = Field(default=None, min_length=1, max_length=50)
    student_id: str | None = None
    gender: str | None = _GENDER
    avatar: str | None = Field(default=None, max_length=255)


class UserUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    #: 登录用户名可改：导入名单/学工系统里用户名写错时，靠改名对齐而不是删号重建
    #: （删号会连带删掉训练历史，改名只换登录键）。
    username: str | None = Field(default=None, min_length=1, max_length=50)
    display_name: str | None = None
    student_id: str | None = None
    memberships: list[UserMembershipUpdate] | None = Field(
        default=None, description="成员关系全量替换；省略该键 = 不修改"
    )
    #: 院校归属（单位）。省略 = 不修改。平台角色可跨院校调整；院校管理员只能提交本校
    #: （跨校 = 404），越界写入规则见 ``core.tenant.writable_school_id``。
    school_id: int | None = Field(default=None, gt=0, description="所属院校；省略 = 不修改")
    role: str | None = None
    password: str | None = Field(default=None, min_length=6)
    gender: str | None = _GENDER
    avatar: str | None = Field(default=None, max_length=255)
    #: 启用/停用；停用是软删（保留训练数据，仅切断登录）
    is_active: bool | None = None


class StudentRecentRecord(BaseModel):
    """学生详情页最近训练记录项（TrainingRecordBrief 子集）"""

    model_config = _RESP_CFG
    id: int
    case_id: int
    case_name: str
    user_id: int
    user_display_name: str
    user_student_id: str | None
    status: str
    start_time: datetime
    end_time: datetime | None
    score_total: float | None = None
    scoring_status: str | None = None
    scoring_error: str | None = None
    assignment_id: str | None = None
    assignment_title: str | None = None


class StudentDailyStat(BaseModel):
    """学生详情页每日训练统计项"""

    model_config = _RESP_CFG
    date: str
    sessions: int = 0
    minutes: float = 0
    avg_score: float | None = None


class StudentDetail(BaseModel):
    model_config = _RESP_CFG
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None
    created_at: datetime
    total_sessions: int = 0
    total_minutes: int = 0
    avg_score: float | None = None
    recent_records: list[StudentRecentRecord] = []
    daily: list[StudentDailyStat] = []


class BatchUserItem(BaseModel):
    model_config = _REQ_CFG
    #: 空值/弱密码不在这里拦：批量接口的处理单位是「行」，请求级校验会把一行的脏数据
    #: 变成整批 422（45 行因为 1 个空字段全没导）。逐行判定在 `batch_create`，落进
    #: `skipped_rows` 就能带行号回执；这里只留 type/DB 宽度这类结构约束。
    username: str = Field(max_length=50)
    password: str
    display_name: str = Field(max_length=50)
    role: str = Field(default="student", min_length=1, max_length=20)
    student_id: str | None = None
    class_id: int | None = None
    class_name: str | None = None
    cohort_label: str | None = Field(default=None, max_length=40, description="班级名歧义时用于消歧")
    #: 院校名称（导入模板的「学校」列）。平台角色没有班级时必须给出；与班级同时给出且
    #: 不一致会被拒（院校归属不能有两个答案）。院校管理员可留空（强制本校）。
    school_name: str | None = Field(default=None, max_length=80)


class RegisterResponse(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None = None


class BatchSkipItem(BaseModel):
    """被跳过的导入行：行序 + 账号 + 原因。

    ``index`` 是**提交批次内**的 1-based 行序（后端只见到前端过滤后的数组），
    调用方负责映射回它自己的行号 —— 前端会映射回 CSV 行号。
    """

    index: int
    username: str
    reason: str


class BatchCreateResult(BaseModel):
    created: int
    #: 已存在同学号学生、本次只补班级归属的行数（不新建账号，历史留在原账号上）
    linked: int = 0
    skipped: int
    skipped_rows: list[BatchSkipItem]


BatchAction = Literal["create", "link", "skip"]


class BatchPreviewRow(BaseModel):
    """预检的一行：文件里这一行会被怎么处理。

    ``link`` 需要能追溯到具体账号，否则管理员没法判断「并入」是不是并对了人。
    """

    model_config = _RESP_CFG
    index: int
    username: str
    display_name: str
    student_id: str | None = None
    action: BatchAction
    reason: str | None = None
    class_label: str | None = None
    #: 该行引用的班级尚不存在（提交时会新建），预检阶段只预告、不落库
    will_create_class: bool = False
    #: ``link`` 时命中的既有账号（用户名 / 姓名），供管理员核对
    existing_username: str | None = None
    existing_display_name: str | None = None


class BatchPreviewResult(BaseModel):
    model_config = _RESP_CFG
    create: int
    link: int
    skip: int
    rows: list[BatchPreviewRow]
