"""
诊断端点 —— 对外暴露系统诊断数据

GET /api/diagnose?token=<token>
  → { "code": 0, "data": { ... }, "message": "success" }

认证方式（二选一）：
  1. DIAGNOSE_TOKEN 环境变量 — 查询参数 token 必须匹配
  2. 无 DIAGNOSE_TOKEN（留空）— 端点挂起，返回 404
"""

import os

from fastapi import APIRouter, HTTPException, Query

from core.diagnose import get_diagnose_service

router = APIRouter(tags=["diagnose"])

# 从环境读取诊断 token（生产/测试服 .env 中设置）
_DIAGNOSE_TOKEN = os.getenv("DIAGNOSE_TOKEN", "")


@router.get("/api/diagnose")
async def diagnose(
    token: str = Query("", description="诊断接口访问令牌"),
):
    # Token 校验
    if not _DIAGNOSE_TOKEN:
        # 未配置 token → 端点隐藏
        raise HTTPException(status_code=404, detail="not found")

    if token != _DIAGNOSE_TOKEN:
        raise HTTPException(status_code=403, detail="invalid token")

    service = get_diagnose_service()
    data = await service.get_diagnose()
    return data
