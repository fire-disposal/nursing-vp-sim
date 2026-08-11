"""Per-purpose LLM call profiles — single source of truth.

Each profile defines the complete LLM call configuration for a purpose:
model, timeout, token budget, temperature, retry policy, response format, concurrency.

NOT configurable via env vars — all changes go through code review.
Admin-managed fields (API key, base URL, pricing, cost limits) remain in DB.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LLMProfile:
    """Immutable configuration for a single LLM call purpose."""

    model: str
    timeout: int = 30
    max_tokens: int = 512
    temperature: float = 0.7
    max_retries: int = 2
    response_format: dict | None = None
    semaphore: int = 50
    """Max concurrent calls for this purpose."""

    enable_thinking: bool = False
    """是否启用 DeepSeek 推理模式 (reasoning_effort=high + thinking)。仅评分链需要。"""


# ── Purpose registry ──

PROFILES: dict[str, LLMProfile] = {
    "patient_chat": LLMProfile(
        model="deepseek-v4-flash",
        timeout=30,
        max_tokens=512,
        temperature=0.6,
        max_retries=2,
        semaphore=500,
    ),
    "qa": LLMProfile(
        model="deepseek-v4-flash",
        timeout=30,
        max_tokens=1024,
        temperature=0.7,
        max_retries=2,
        semaphore=500,
    ),
    "expert_consult": LLMProfile(
        model="deepseek-v4-flash",
        timeout=60,
        max_tokens=1024,
        temperature=0.3,
        max_retries=2,
        semaphore=100,
    ),
    "scoring": LLMProfile(
        model="deepseek-v4-flash",
        timeout=120,
        max_tokens=65536,
        temperature=0,
        max_retries=3,
        response_format={"type": "json_object"},
        semaphore=200,
        enable_thinking=True,
    ),
    "scoring_feedback": LLMProfile(
        model="deepseek-v4-flash",
        timeout=60,
        max_tokens=65536,
        temperature=0.3,
        max_retries=2,
        response_format={"type": "json_object"},
        semaphore=200,
        enable_thinking=True,
    ),
    "case_generation": LLMProfile(
        model="deepseek-v4-flash",
        timeout=120,
        max_tokens=4096,
        temperature=0.3,
        max_retries=3,
        semaphore=100,
        response_format={"type": "json_object"},
    ),
    "emotion_analysis": LLMProfile(
        model="deepseek-v4-flash",
        timeout=10,
        max_tokens=128,
        temperature=0.3,
        max_retries=1,
        semaphore=100,
        response_format={"type": "json_object"},
    ),
}

# Default profile for unknown purposes — uses flash, conservative settings
_DEFAULT = LLMProfile(
    model="deepseek-v4-flash", timeout=30, max_tokens=512, temperature=0.7, max_retries=2, semaphore=500
)


def get_llm_config(purpose: str) -> dict:
    """Return a dict of kwargs for LLMClient.call() / call_json() / call_with_tools().

    Includes only parameters accepted by those methods: timeout, max_tokens,
    temperature, max_retries, response_format.
    Model is resolved separately via get_model().
    """
    p = _resolve(purpose)
    cfg: dict = {
        "timeout": p.timeout,
        "max_tokens": p.max_tokens,
        "temperature": p.temperature,
        "max_retries": p.max_retries,
    }
    if p.response_format:
        cfg["response_format"] = p.response_format
    return cfg


def get_model(purpose: str) -> str:
    """Return the model name for a purpose. Use this instead of DB LLMConfig.model."""
    return _resolve(purpose).model


def get_semaphore(purpose: str) -> int:
    """Return the concurrency limit for a purpose."""
    return _resolve(purpose).semaphore


def get_enable_thinking(purpose: str) -> bool:
    """Return whether DeepSeek thinking mode is enabled for a purpose."""
    return _resolve(purpose).enable_thinking


def _resolve(purpose: str) -> LLMProfile:
    for prefix in sorted(PROFILES, key=len, reverse=True):
        if purpose.startswith(prefix):
            return PROFILES[prefix]
    return _DEFAULT
