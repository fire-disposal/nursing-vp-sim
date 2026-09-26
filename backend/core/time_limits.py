"""训练时限的唯一口径。

为什么放在 core：时限同时被 `schemas`（病例 JSON 校验）、`modules.cases`
（病例元数据）与 `modules.training`（倒计时/结算）消费。放在任一业务域都会
造成 schemas → training → router → schemas 的循环导入，因此常量与解析规则
下沉到不依赖业务模块的 core。

规则：**声明即生效，禁止静默改写**。输入越界由校验层拒绝（HTTP 422 / 病例发布
失败）；只有在历史数据越界时才按边界收敛，并留下 warning，使越界可见。
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

DEFAULT_TIME_LIMIT_MINUTES = 30
MIN_TIME_LIMIT_MINUTES = 30
MAX_TIME_LIMIT_MINUTES = 180


def resolve_time_limit_minutes(declared: int | None, *, source: str) -> int:
    """把「病例列 / 作业配置」声明的时限解析为生效值。"""
    if declared is None:
        return DEFAULT_TIME_LIMIT_MINUTES
    value = int(declared)
    if MIN_TIME_LIMIT_MINUTES <= value <= MAX_TIME_LIMIT_MINUTES:
        return value
    clamped = max(MIN_TIME_LIMIT_MINUTES, min(MAX_TIME_LIMIT_MINUTES, value))
    log.warning(
        "训练时限越界，按边界收敛: source=%s declared=%d effective=%d",
        source,
        value,
        clamped,
        extra={"time_limit_source": source, "declared": value, "effective": clamped},
    )
    return clamped
