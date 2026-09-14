"""DeepSeek token 计数与成本计算 —— 全局唯一，基于官方中文文档。

Token 换算比例 (官方中文文档):
  - 1 个中文字符 ≈ 0.6 token
  - 1 个英文字符 ≈ 0.3 token

定价 (元/百万 tokens, 2026-08 官方中文 api-docs.deepseek.com/zh-cn/quick_start/pricing):
  - deepseek-v4-flash:  输入 ¥1,    输出 ¥2      (缓存命中 ¥0.02/¥0)
  - deepseek-v4-pro:    输入 ¥3,    输出 ¥6      (缓存命中 ¥0.025/¥0)

峰谷计费 (官方，以正式通知为准): 高峰时段价格为平时 2 倍，适用所有计费项；
高峰时段 = 北京时间每日 09:00~12:00 与 14:00~18:00。

估算 vs 真实用量 (评审 R4): 上面的字符比例只是估算，API 返回 usage 时真实 token 数
通常更高。`reconcile_tokens` 是对账入口：给出差值/比例供日志与指标消费，调用方据此
把预算按真实值校正（见 modules.training.context.budget.resolve_token_scale）。
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone

# ── 官方换算比例 ──
_CJK_TOKENS_PER_CHAR = 0.6
_EN_TOKENS_PER_CHAR = 0.3

# ── 官方 CNY 定价 (元/百万 tokens, 缓存未命中) ──
_PRICE_FLASH = (1.0, 2.0)  # (input, output)
_PRICE_PRO = (3.0, 6.0)

# ── 缓存命中价 (元/百万 tokens) ──
_CACHE_PRICE_FLASH = 0.02
_CACHE_PRICE_PRO = 0.025

# ── 模型识别 —— 含 "pro" 则按 pro 计费 ──
_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]")

# ── 峰谷计费：北京时间固定 UTC+8（中国无夏令时），判定必须基于此偏移而非服务器本地时区 ──
_BEIJING_TZ = timezone(timedelta(hours=8))
_PEAK_HOUR_RANGES = ((9, 12), (14, 18))  # 北京 09:00~12:00、14:00~18:00（左闭右开）


def estimate_tokens(text: str) -> int:
    """基于 DeepSeek 官方比例估算 token 数。API 返回 usage 时不应调用此函数。

    2026-09-14 校准（staging 生产语料 10 875 条 LLM 调用日志，`prompt_tokens / request_chars`）：

    | purpose | 调用数 | 实测 tokens/char | 标准差 |
    |---|---|---|---|
    | patient_chat | 5306 | **0.6498** | 0.079 |
    | emotion_analysis | 4499 | 0.5506 | 0.021 |
    | scoring_feedback | 525 | 0.5746 | 0.020 |
    | scoring | 516 | 0.4554 | 0.034 |
    | qa | 27 | 2.4925 | 5.54 |

    → 主用途漂移 ≤8%，本估算器（0.6/0.3 混合）对 `patient_chat` 实际落在 0.65，
    与真实值吻合；因此**不需要**按轮反馈校正，`context.budget.resolve_token_scale`
    仅作为换模型/非中文内容时的安全网保留（默认 1.0）。

    注意 `qa`：实测比值 2.49 且方差极大，说明其 `request_chars` 未计入工具结果/RAG 注入的
    内容——该用途的 token 估算不可信，若要按 token 管控 qa 需先修 `request_chars` 口径。
    """
    if not text:
        return 0
    cjk_count = len(_CJK_RE.findall(text))
    other_count = len(text) - cjk_count
    tokens = cjk_count * _CJK_TOKENS_PER_CHAR + other_count * _EN_TOKENS_PER_CHAR
    return max(1, round(tokens))


@dataclass(frozen=True)
class TokenReconciliation:
    """估算用量与 API 实际用量的对账结果（评审 R4）。

    ``delta`` / ``ratio`` 供日志与指标消费：``ratio > 1`` 表示启发式低估了真实
    用量，预算应按该比例收紧，而不是继续按 0.6/0.3 的字符比例判断。
    """

    estimated: int
    actual: int
    delta: int
    ratio: float


def reconcile_tokens(estimated: int, actual: int | None) -> TokenReconciliation:
    """对账入口：``actual`` 为 API usage 的真实 token 数，缺省时回退为估算值。

    回退（``actual is None``）时 ``delta == 0`` 且 ``ratio == 1.0``，调用方无需分支。
    ``estimated == 0`` 时 ``ratio`` 定义为 1.0（无从比较，不做校正）。
    """
    est = max(0, int(estimated or 0))
    act = est if actual is None else max(0, int(actual))
    return TokenReconciliation(
        estimated=est,
        actual=act,
        delta=act - est,
        ratio=(act / est) if est else 1.0,
    )


def get_model_price_cny(model: str) -> tuple[float, float]:
    """返回 (input_price_cny_per_1m, output_price_cny_per_1m)。

    若模型不在识别列表内，返回 deepseek-v4-flash 定价作为默认值。
    """
    model_lower = model.lower()
    if "pro" in model_lower:
        return _PRICE_PRO
    return _PRICE_FLASH


def get_cache_price_cny(model: str) -> float:
    """返回缓存命中输入价 (元/百万 tokens)。"""
    return _CACHE_PRICE_PRO if "pro" in (model or "").lower() else _CACHE_PRICE_FLASH


def is_peak_hour(at_utc: datetime | None = None) -> bool:
    """判断调用时刻是否处于 DeepSeek 官方高峰时段。

    高峰时段按北京时间定义（09:00~12:00、14:00~18:00，左闭右开）。入参必须是
    UTC-aware 时刻（naive 视为 UTC）；函数内部做 UTC→北京时间换算，避免依赖
    服务器本地时区（时区校准）。
    """
    if at_utc is None:
        at_utc = datetime.now(UTC)
    at_utc = at_utc.replace(tzinfo=UTC) if at_utc.tzinfo is None else at_utc.astimezone(UTC)
    hour = at_utc.astimezone(_BEIJING_TZ).hour
    return any(start <= hour < end for start, end in _PEAK_HOUR_RANGES)


def peak_multiplier(at_utc: datetime | None = None) -> float:
    """返回峰谷价格因子：高峰 = LLM_PEAK_MULTIPLIER（默认 2.0），平峰 = 1.0。

    官方标注峰谷计费"具体时间以正式通知为准"，故默认关闭；
    以 LLM_PEAK_PRICING_ENABLED=true 开启后生效。
    """
    from core.config import LLM_PEAK_MULTIPLIER, LLM_PEAK_PRICING_ENABLED

    if not LLM_PEAK_PRICING_ENABLED:
        return 1.0
    return float(LLM_PEAK_MULTIPLIER) if is_peak_hour(at_utc) else 1.0


def estimate_cost_cny(
    prompt_tokens: int,
    completion_tokens: int,
    *,
    price_input: float | None = None,
    price_output: float | None = None,
    model: str | None = None,
    cache_hit_tokens: int = 0,
    at: datetime | None = None,
) -> float:
    """统一成本计算 (CNY)。定价优先级：模型（权威官方价）> 显式 key 价（仅当无 model）> 环境变量回退。

    单个 ApiSecret 只有一对价格，无法表达多模型定价；pro/flash 官方价才是正确的
    每模型定价维度（修复 H-1：pro 被按 flash 少计 ~3x）。

    缓存命中的 prompt token 按缓存价计（修复 M-1：全额输入价会高估）。无 model 时不做
    缓存折扣（按满额输入价），保持向后兼容。

    峰谷计费：结果为平峰价 × peak_multiplier(at)。传入调用发生的 UTC 时刻，保证
    历史日志重算与实时记账一致（时区校准：高峰时段按北京时间判定）。
    """
    if model:
        pi, po = get_model_price_cny(model)
    elif price_input is not None and price_input > 0 and price_output is not None and price_output > 0:
        pi, po = price_input, price_output
    else:
        from core.config import LLM_PRICE_INPUT_PER_1M, LLM_PRICE_OUTPUT_PER_1M

        pi, po = LLM_PRICE_INPUT_PER_1M, LLM_PRICE_OUTPUT_PER_1M

    hit = max(0, min(cache_hit_tokens or 0, prompt_tokens or 0))
    miss = max(0, (prompt_tokens or 0) - hit)
    cache_price = get_cache_price_cny(model) if model else float(pi)
    mult = peak_multiplier(at)
    base = (
        miss / 1_000_000 * float(pi)
        + hit / 1_000_000 * float(cache_price)
        + (completion_tokens or 0) / 1_000_000 * float(po)
    )
    return round(base * mult, 6)
