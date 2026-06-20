"""DeepSeek token 计数与成本计算 —— 全局唯一，基于官方中文文档。

Token 换算比例 (官方中文文档):
  - 1 个中文字符 ≈ 0.6 token
  - 1 个英文字符 ≈ 0.3 token

定价 (元/百万 tokens, 2026-06 官方中文):
  - deepseek-v4-flash:  输入 ¥1,    输出 ¥2      (缓存命中 ¥0.02/¥0)
  - deepseek-v4-pro:    输入 ¥3,    输出 ¥6      (缓存命中 ¥0.025/¥0)
"""

import re

# ── 官方换算比例 ──
_CJK_TOKENS_PER_CHAR = 0.6
_EN_TOKENS_PER_CHAR = 0.3

# ── 官方 CNY 定价 (元/百万 tokens, 缓存未命中) ──
_PRICE_FLASH = (1.0, 2.0)  # (input, output)
_PRICE_PRO = (3.0, 6.0)

# ── 模型识别 —— 含 "pro" 则按 pro 计费 ──
_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]")


def estimate_tokens(text: str) -> int:
    """基于 DeepSeek 官方比例估算 token 数。API 返回 usage 时不应调用此函数。"""
    if not text:
        return 0
    cjk_count = len(_CJK_RE.findall(text))
    other_count = len(text) - cjk_count
    tokens = cjk_count * _CJK_TOKENS_PER_CHAR + other_count * _EN_TOKENS_PER_CHAR
    return max(1, round(tokens))


def get_model_price_cny(model: str) -> tuple[float, float]:
    """返回 (input_price_cny_per_1m, output_price_cny_per_1m)。

    若模型不在识别列表内，返回 deepseek-v4-flash 定价作为默认值。
    """
    model_lower = model.lower()
    if "pro" in model_lower:
        return _PRICE_PRO
    return _PRICE_FLASH


def estimate_cost_cny(
    prompt_tokens: int,
    completion_tokens: int,
    *,
    price_input: float | None = None,
    price_output: float | None = None,
    model: str | None = None,
) -> float:
    """统一成本计算 (CNY)。定价优先级：显式传入 > 模型识别 > 全局环境变量回退。"""
    pi = price_input if price_input is not None and price_input > 0 else None
    po = price_output if price_output is not None and price_output > 0 else None

    if pi is None or po is None:
        if model:
            mpi, mpo = get_model_price_cny(model)
            if pi is None:
                pi = mpi
            if po is None:
                po = mpo
        else:
            from core.config import LLM_PRICE_INPUT_PER_1M, LLM_PRICE_OUTPUT_PER_1M

            if pi is None:
                pi = LLM_PRICE_INPUT_PER_1M
            if po is None:
                po = LLM_PRICE_OUTPUT_PER_1M

    return round(prompt_tokens / 1_000_000 * float(pi) + completion_tokens / 1_000_000 * float(po), 6)
