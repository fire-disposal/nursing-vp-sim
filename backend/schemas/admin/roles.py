from pydantic import BaseModel

from schemas.common import _RESP_CFG


class RoleResponse(BaseModel):
    """账号类型（角色）：权限不再挂在这里，见 core/personas.py。"""

    model_config = _RESP_CFG
    id: int
    name: str
    display_name: str
    is_system: bool = False
    user_count: int = 0
