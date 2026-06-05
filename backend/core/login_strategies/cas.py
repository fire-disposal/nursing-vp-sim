import logging
from typing import Any

from models import User
from . import LoginStrategy

log = logging.getLogger(__name__)


class CASLoginStrategy(LoginStrategy):
    """
    CAS (Central Authentication Service) 登录策略（骨架，待对接学校时实现）。

    标准流程：
      1. 前端跳转 GET /auth/sso/cas/{provider_id}/login → 后端返回 CAS login URL + service 参数
      2. 用户在 CAS 页面输入学号密码
      3. CAS 回调 service URL 并附带 ticket=ST-xxx
      4. 后端用 ticket 调 CAS /serviceValidate，解析 XML 获取学号
      5. 按 User.student_id 匹配本地账号，签发 JWT

    对接前需准备：
      - 在 auth_providers 表（未来创建）中配置学校的 issuer_url
      - 确认学校的 CAS 版本（v2 用 /serviceValidate，v3 用 /p3/serviceValidate）

    参考标准：
      - CAS Protocol 3.0: https://apereo.github.io/cas/6.6.x/protocol/CAS-Protocol.html
    """
    provider_type = "cas"

    async def authenticate(self, credentials: dict[str, Any]) -> User | None:
        raise NotImplementedError("CAS 策略尚未对接具体学校，待 auth_providers 表就绪后实现。")
