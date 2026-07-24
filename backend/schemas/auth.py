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
    gender: str | None = _GENDER


class TokenResponse(BaseModel):
    model_config = _RESP_CFG
    access_token: str
    token_type: str = "bearer"
    role: str
    display_name: str
    user_id: int
    permissions: list[str] = []
    gender: str | None = None
    avatar: str | None = None


class ChangePasswordRequest(BaseModel):
    model_config = _REQ_CFG
    old_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=128)
