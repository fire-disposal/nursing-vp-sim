from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

_GENDER = Field(default=None, pattern=r"^(男|女)?$")


class LoginRequest(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)


class RegisterRequest(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6)
    role: str = Field(default="student", min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=50)
    student_id: str | None = None
    class_id: int | None = None
    #: 院校归属。给了 `class_id` 时以班级所在院校为准；院校管理员可省略（强制本校），
    #: 平台角色两者都不给会被拒 —— 不允许建出“无院校”的日常账号。
    school_id: int | None = None
    gender: str | None = _GENDER


class TokenResponse(BaseModel):
    model_config = _RESP_CFG
    access_token: str
    token_type: str = "bearer"
    role: str
    display_name: str
    user_id: int
    permissions: list[str] = []
    #: 该账号被授予的视角（超管 = 全部）；前端据此渲染视角切换器
    personas: list[str] = []
    #: 登录后默认生效的视角（自定义角色为 role.name，无视角为 null）
    active_persona: str | None = None
    gender: str | None = None
    avatar: str | None = None


class ChangePasswordRequest(BaseModel):
    model_config = _REQ_CFG
    old_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=128)
