import logging

import httpx

from core.config import WECHAT_APPID, WECHAT_SECRET

log = logging.getLogger(__name__)

WECHAT_API = "https://api.weixin.qq.com"


async def code2session(code: str) -> dict:
    """用小程序 code 换取 openid 和 session_key"""
    if not WECHAT_APPID or not WECHAT_SECRET:
        raise RuntimeError("WECHAT_APPID 或 WECHAT_SECRET 未配置")

    url = (
        f"{WECHAT_API}/sns/jscode2session"
        f"?appid={WECHAT_APPID}&secret={WECHAT_SECRET}&js_code={code}&grant_type=authorization_code"
    )
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
        data = resp.json()

    if "errcode" in data and data["errcode"] != 0:
        log.error("微信 code2session 失败: errcode=%s errmsg=%s", data.get("errcode"), data.get("errmsg"))
        raise RuntimeError(f"微信登录失败: {data.get('errmsg', '未知错误')}")

    return data
