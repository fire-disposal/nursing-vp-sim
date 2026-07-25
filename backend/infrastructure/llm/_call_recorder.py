"""CallRecorder — unified logging, metrics, and cost estimation sidecar for LLMClient.

Extracted from client.py to eliminate ~120 lines of duplicated success/failure
logging across call(), stream(), and call_with_tools().
"""

import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class CallMeta:
    """Aggregated metadata for a single LLM call log entry."""

    purpose: str
    model: str = ""
    temperature: float = 0.7
    max_tokens: int = 512
    latency_ms: int = 0
    status: str = "success"
    error_type: str | None = None
    request_text: str = ""
    response_text: str = ""
    usage: dict | None = None
    meta: dict | None = None
    config_id: int | None = None
    provider_name: str = ""
    price_input: float = 0.0
    price_output: float = 0.0
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0
    user_id: int | None = None
    record_id: int | None = None
    case_id: int | None = None


class CallRecorder:
    """Encapsulates log enqueueing, cost estimation, and metrics recording."""

    def __init__(self, log_worker, metrics=None):
        self._log_worker = log_worker
        self._metrics = metrics

    def record_success(self, meta: CallMeta) -> float:
        """Log a successful call, estimate cost, record metrics. Returns actual_cost."""
        self._log_worker.enqueue(
            purpose=meta.purpose,
            user_id=meta.user_id,
            record_id=meta.record_id,
            case_id=meta.case_id,
            model=meta.model,
            temperature=meta.temperature,
            max_tokens=meta.max_tokens,
            latency_ms=meta.latency_ms,
            status="success",
            request_text=meta.request_text,
            response_text=meta.response_text,
            usage=meta.usage or None,
            meta=meta.meta,
            config_id=meta.config_id,
            provider_name=meta.provider_name,
            key_price_input=meta.price_input,
            key_price_output=meta.price_output,
            cache_hit_tokens=meta.cache_hit_tokens,
            cache_miss_tokens=meta.cache_miss_tokens,
        )
        usage = meta.usage or {}
        prompt_tokens = usage.get("prompt_tokens", 0) or 0
        completion_tokens = usage.get("completion_tokens", 0) or 0
        total_tokens = usage.get("total_tokens", 0) or prompt_tokens + completion_tokens
        actual_cost = self._estimate_cost(
            prompt_tokens, completion_tokens, meta.price_input, meta.price_output, meta.model, meta.cache_hit_tokens
        )
        self._record_metrics(status="success", tokens=total_tokens, cost=actual_cost, latency_ms=meta.latency_ms)
        return actual_cost

    def record_failure(self, meta: CallMeta):
        """Log a failed call and record error metrics."""
        self._log_worker.enqueue(
            purpose=meta.purpose,
            user_id=meta.user_id,
            record_id=meta.record_id,
            case_id=meta.case_id,
            model=meta.model,
            temperature=meta.temperature,
            max_tokens=meta.max_tokens,
            latency_ms=meta.latency_ms,
            status="failed",
            error_type=meta.error_type or "all_providers_failed",
            request_text=meta.request_text,
            meta=meta.meta,
            config_id=meta.config_id,
            provider_name=meta.provider_name,
            key_price_input=meta.price_input,
            key_price_output=meta.price_output,
        )
        self._record_metrics(status="error", tokens=0, cost=0.0, latency_ms=meta.latency_ms)

    @staticmethod
    def _estimate_cost(prompt_tokens: int, completion_tokens: int, price_input: float, price_output: float,
                       model: str, cache_hit: int = 0) -> float:
        from infrastructure.llm.token_counter import estimate_cost_cny

        return estimate_cost_cny(prompt_tokens or 0, completion_tokens or 0,
                                  price_input=price_input, price_output=price_output,
                                  model=model, cache_hit_tokens=cache_hit)

    def _record_metrics(self, *, status: str, tokens: int, cost: float, latency_ms: int) -> None:
        if self._metrics:
            self._metrics.record_llm_call(status=status, tokens=tokens, cost=cost, latency_ms=latency_ms)
