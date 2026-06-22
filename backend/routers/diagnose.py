"""
诊断端点 —— 对外暴露系统诊断数据

GET /api/diagnose?token=<token>
  → 返回系统诊断快照

认证方式（二选一）：
  1. DIAGNOSE_TOKEN 环境变量 — 查询参数 token 必须匹配
  2. 无 DIAGNOSE_TOKEN（留空）— 端点挂起，返回 404
"""

from fastapi import APIRouter, HTTPException, Query

from core.config import DIAGNOSE_TOKEN
from core.diagnose import get_diagnose_service

router = APIRouter(tags=["diagnose"])


@router.get("/api/diagnose")
async def diagnose(
    token: str = Query("", description="诊断接口访问令牌"),
):
    if not DIAGNOSE_TOKEN:
        raise HTTPException(status_code=404, detail="not found")

    if token != DIAGNOSE_TOKEN:
        raise HTTPException(status_code=403, detail="invalid token")

    service = get_diagnose_service()
    return await service.get_diagnose()
