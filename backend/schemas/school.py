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


class DeleteSchoolResponse(BaseModel):
    model_config = _RESP_CFG
    ok: bool = True
    message: str = ""
