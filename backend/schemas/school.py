"""院校（租户）的请求/响应模型。"""

from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

#: 主题色键：前端 `theme/school-palettes` 里的调色板名（不含 #，不接受任意 CSS）。
#: 空串 = 清除（回到平台默认品牌色）。
_THEME_COLOR = Field(default=None, pattern=r"^[a-z]{3,20}$|^$", description="主题色调色板键；空串 = 清除")


class SchoolCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=80)
    theme_color: str | None = _THEME_COLOR


class SchoolUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, min_length=1, max_length=80)
    #: 省略 = 不修改；空串 = 恢复平台默认品牌色
    theme_color: str | None = _THEME_COLOR


class SchoolResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    class_count: int = 0
    user_count: int = 0
    #: 该院校里持有 `user_manage` 的账号数（= 院校管理员数量）。0 意味着没人能管这所院校。
    admin_count: int = 0
    #: 品牌：主题色调色板键（空 = 平台默认）；院徽是否存在与版本号（前端据此带 `?v=` 缓存）
    theme_color: str | None = None
    has_logo: bool = False
    logo_updated_at: datetime | None = None
    created_at: datetime


class SchoolDetailClassItem(BaseModel):
    """院校详情里的班级条目（只读摘要，点进去是现有的班级详情页）。"""

    model_config = _RESP_CFG
    id: int
    name: str
    cohort_label: str
    student_count: int = 0
    teacher_count: int = 0
    created_at: datetime


class SchoolDetailResponse(SchoolResponse):
    """院校详情：列表字段 + 「进入管理」前要先看清的两件事。

    - 用量与额度：与 `SchoolQuotaModal` 同一数据源（月度 LLM/TTS 账单 + 上限 + 用户默认日额度）
    - 班级摘要：本院校的班级列表（最多 ``SCHOOL_DETAIL_CLASS_LIMIT`` 个，全量仍在 /admin/classes）
    """

    #: 本月 LLM/TTS 账单（当前生效院校维度；单位与成本管理一致）
    llm_used: float = 0.0
    tts_used: float = 0.0
    #: 月度上限；0 = 不限
    llm_monthly_limit: float = 0.0
    tts_monthly_limit: float = 0.0
    #: 院校内用户的默认日额度；null = 继承平台默认
    default_daily_llm_limit: float | None = None
    default_daily_tts_limit: float | None = None
    classes: list[SchoolDetailClassItem] = Field(default_factory=list)
    #: 班级总数（`classes` 只是前若干个）
    class_total: int = 0


class DeleteSchoolResponse(BaseModel):
    model_config = _RESP_CFG
    ok: bool = True
    message: str = ""
