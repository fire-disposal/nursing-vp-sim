"""分数映射 —— 单一策略（Phase 1 契约）。

系统只有一套映射：原始分（raw_total，Σ条目）→ 展示分（0-100），恒为线性

    display = round(raw_total / raw_max * 100)

（``raw_max == 100`` 时即恒等）。落库换算（``_convert_to_100_scale``）与
复核换算（``review_total_from_detail``）共用 ``display_factor()`` 的同一因子，
两条刻度因此永远一致。

``mapping_version`` 只标记"展示分能否重算"，不是曲线选择器：

    1 = 有 raw_total，展示分可由上式重算（现行口径）
    0 = 旧口径历史分（raw_total=NULL，展示分不可逆）

新增曲线属于口径变更，必须同时给出新 version、历史分重算说明与消费方改造；
在此之前不保留未生效的曲线分支（避免"声明了 sqrt/power 却只有线性生效"的假配置）。
"""

# 展示分上限（0-100 分制）
DISPLAY_MAX = 100

# 现行口径版本：展示分可由 raw_total 重算
MAPPING_VERSION = 1

# 旧口径标记：mapping_version=0 的历史分（无 raw_total，展示分不可重算）
LEGACY_VERSION = 0


def apply_score_mapping(raw_score: float, raw_max: int) -> int:
    """将原始分映射为展示分（0 到 DISPLAY_MAX 的整数）。"""
    if raw_max <= 0 or raw_score <= 0:
        return 0
    display = round(raw_score / raw_max * DISPLAY_MAX)
    return max(0, min(display, DISPLAY_MAX))


def display_factor(raw_max: int) -> float:
    """展示刻度因子：raw 刻度 × factor = 展示刻度。

    落库换算与复核换算的唯一来源——因子若各写一份，复核"不改分提交"
    就不再恒等（S1 根因）。
    """
    return DISPLAY_MAX / raw_max if raw_max > 0 else 1.0
