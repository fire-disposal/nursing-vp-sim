import logging
from typing import Any

from models import User
from . import LoginStrategy

log = logging.getLogger(__name__)


class OAuth2LoginStrategy(LoginStrategy):
    """
    OAuth2 / OIDC 登录策略（骨架，待对接学校时实现）。

    标准流程：
      1. 前端构造 GET /auth/sso/oauth2/{provider_id}/login → 后端返回 redirect_url
      2. 浏览器跳转到学校统一认证页，用户输入学号密码
      3. 学校回调 GET /auth/sso/oauth2/{provider_id}/callback?code=xxx&state=yyy
      4. 后端用 code 换 access_token + id_token，提取 sub（学号）
      5. 按 User.student_id 匹配本地账号，签发 JWT

    对接前需准备：
      - 在 auth_providers 表（未来创建）中配置学校的 issuer_url / client_id / client_secret
      - 确认学校使用的 OIDC 端点（/.well-known/openid-configuration）

    参考标准：
      - OAuth 2.0 RFC 6749: https://datatracker.ietf.org/doc/html/rfc6749
      - OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0.html
    """
    provider_type = "oauth2"

    async def authenticate(self, credentials: dict[str, Any]) -> User | None:
        raise NotImplementedError("OAuth2 策略尚未对接具体学校，待 auth_providers 表就绪后实现。")


# noqa: E501 — URL references above are intentionally long
