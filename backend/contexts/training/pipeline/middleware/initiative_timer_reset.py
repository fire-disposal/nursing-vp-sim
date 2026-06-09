# backend/contexts/training/pipeline/middleware/initiative_timer_reset.py
from backend.contexts.patient.initiative import update_initiative_timer


async def initiative_timer_reset(ctx):
    """主动回复计时器重置中间件：每次患者回复后重置计时"""
    update_initiative_timer(ctx.record.id)
    return ctx
