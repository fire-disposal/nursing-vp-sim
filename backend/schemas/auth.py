from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


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
    gender: str | None = Field(default=None, max_length=4)


class TokenResponse(BaseModel):
    model_config = _RESP_CFG
    access_token: str
    token_type: str = "bearer"
    role: str
    display_name: str
    user_id: int
    school_id: int | None = None
    school_name: str | None = None
    permissions: list[str] = []
    gender: str | None = None
    avatar: str | None = None


class ChangePasswordRequest(BaseModel):
    model_config = _REQ_CFG
    old_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=128)


class WechatLoginRequest(BaseModel):
    model_config = _REQ_CFG
    code: str = Field(min_length=1)


class WechatBindRequest(BaseModel):
    model_config = _REQ_CFG
    code: str = Field(min_length=1)


class WechatRegisterRequest(BaseModel):
    model_config = _REQ_CFG
    code: str = Field(min_length=1)
    display_name: str = Field(min_length=1, max_length=50)


class WechatLoginResponse(BaseModel):
    model_config = _RESP_CFG
    access_token: str | None = None
    token_type: str = "bearer"
    role: str | None = None
    display_name: str | None = None
    user_id: int | None = None
    school_id: int | None = None
    school_name: str | None = None
    permissions: list[str] = []
    need_bind: bool = False
