from pydantic import BaseModel, Field

from core.personas import PersonaScope
from schemas.common import _REQ_CFG, _RESP_CFG


class PersonaCatalogItem(BaseModel):
    """视角目录项：预设 + 作用域 + **调用者作用域内**持有该视角的人数。

    ``user_count`` 按调用者的 ``TenantScope`` 统计（平台全局 / 院校本校），
    超管派生拥有的视角也计入（它没有 ``user_school_personas`` 行）。
    """

    model_config = _RESP_CFG
    key: str
    label: str
    scope: PersonaScope
    permissions: list[str] = []
    #: 只能授予平台账号。前端对院校目标隐藏，避免"能勾但保存必 400"。
    requires_platform_account: bool = False
    user_count: int = 0
    #: 调用者当前能否授予这一档（预设权限 ⊆ 调用者当前视角权限；平台账号恒为 true）。
    #: 前端据此禁用勾选，避免"能勾但保存必 403"。
    grantable: bool = False


class UserPersonasResponse(BaseModel):
    """某账号**当前持有**的视角 key 集合（超管 = 全部，派生）。"""

    model_config = _RESP_CFG
    user_id: int
    personas: list[str] = Field(default_factory=list)


class UserPersonasUpdateRequest(BaseModel):
    """全量替换授予：去重后写入，未知 key → 400，无权授予 → 403。"""

    model_config = _REQ_CFG
    personas: list[str] = Field(default_factory=list, description="要授予的视角 key；全量替换")
