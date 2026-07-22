"""分数映射配置 — 将 rubric 原始分映射到 0-100 显示分。

所有变量通过 ScoreMappingConfig 集中管理，改配置即生效，无需重跑评分。
"""

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class ScoreMappingConfig:
    """评分映射配置
    
    修改此 dataclass 即可调整全局评分映射行为。
    映射基于原始总分 (raw_max) 与显示满分 (display_max) 的比例关系。
    """

    # 显示满分（通常为 100）
    display_max: int = 100

    # 映射曲线类型
    # "linear" — 线性映射: display = raw * (display_max / raw_max)
    # "sqrt"   — 平方根曲线，压低高分段、拉升低分段
    # "power"  — 幂曲线，press_factor 控制弯曲程度
    curve: Literal["linear", "sqrt", "power"] = "linear"

    # 幂曲线参数（仅 curve="power" 时生效）
    # < 1: 压缩高分段，给低分段更多区分度
    # > 1: 拉开高分段差距
    # = 1: 等同于 linear
    press_factor: float = 0.9

    # 最低保障分（原始分 > 0 时，显示分不低于此值）
    floor: int = 0

    # 维度权重覆盖（key: 维度 id, value: 权重系数）
    # 用于调整各维度在总分中的占比，例如：
    #   {"inquiry": 1.2, "physical_exam": 0.8}
    # 空字典则所有维度等权重
    dimension_weights: dict[str, float] = field(default_factory=dict)


# 全局单例 — 模块导入时即创建，运行时可通过修改属性热更新
SCORE_MAPPING = ScoreMappingConfig()


def apply_score_mapping(raw_score: float, raw_max: int, cfg: ScoreMappingConfig | None = None) -> int:
    """将原始评分映射为显示分。
    
    Args:
        raw_score: 原始评分（0 - raw_max）
        raw_max: 原始满分值
        cfg: 映射配置，默认使用全局 SCORE_MAPPING
    
    Returns:
        0 到 display_max 之间的整数显示分
    """
    c = cfg or SCORE_MAPPING

    if raw_max <= 0 or raw_score <= 0:
        return 0
    if raw_max == c.display_max:
        return round(raw_score)

    normalized = max(0.0, min(1.0, raw_score / raw_max))

    if c.curve == "linear":
        display = normalized * c.display_max
    elif c.curve == "sqrt":
        display = (normalized ** 0.5) * c.display_max
    elif c.curve == "power":
        display = (normalized ** c.press_factor) * c.display_max
    else:
        display = normalized * c.display_max

    result = round(display)
    return max(c.floor, min(result, c.display_max))
