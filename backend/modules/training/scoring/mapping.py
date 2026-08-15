"""分数映射配置 — 版本化 MappingPolicy（Phase 1 契约）。

原始分（raw_total，Σ条目）与展示分（total_score，0-100）分离：
- 展示分 = apply_score_mapping(raw_total, raw_max, policy)
- mapping_version 记录所用策略，展示语义可解释、可重算；历史分 raw_total=NULL 不可逆
- 改映射策略 = 新增 version，不重评历史分
"""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class MappingPolicy:
    """版本化映射策略。

    curve:
      "linear" — 线性映射: display = raw * (display_max / raw_max)
      "sqrt"   — 平方根曲线，压低高分段、拉升低分段
      "power"  — 幂曲线，press_factor 控制弯曲程度
    """

    version: int = 1
    display_max: int = 100
    curve: Literal["linear", "sqrt", "power"] = "linear"
    press_factor: float = 0.9
    # 最低保障分（原始分 > 0 时，显示分不低于此值）
    floor: int = 0


# 当前生效策略（v1 = 线性）。新增策略时 +version，历史分 mapping_version 不变。
CURRENT_POLICY = MappingPolicy(version=1, curve="linear")

# 旧口径标记：mapping_version=0 的历史分（无 raw_total，展示分不可重算）
LEGACY_VERSION = 0


def apply_score_mapping(raw_score: float, raw_max: int, cfg: MappingPolicy | None = None) -> int:
    """将原始分映射为展示分（0 到 display_max 的整数）。"""
    c = cfg or CURRENT_POLICY

    if raw_max <= 0 or raw_score <= 0:
        return 0
    if raw_max == c.display_max:
        return round(raw_score)

    normalized = max(0.0, min(1.0, raw_score / raw_max))

    if c.curve == "linear":
        display = normalized * c.display_max
    elif c.curve == "sqrt":
        display = (normalized**0.5) * c.display_max
    elif c.curve == "power":
        display = (normalized**c.press_factor) * c.display_max
    else:
        display = normalized * c.display_max

    result = round(display)
    return max(c.floor, min(result, c.display_max))
