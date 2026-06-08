from .crypto_utils import decrypt_api_key, encrypt_api_key
from .logging import LogWorker
from .parsing import _safe_parse_json
from .provider_catalog import (
    get_catalog,
    get_models_for,
    infer_provider_name,
    match_provider,
)
from .router import (
    ProfileRouter,
    _SyntheticConfig,
    get_env_fallback_state,
    set_env_fallback_state,
)

__all__ = [
    "ProfileRouter",
    "LogWorker",
    "_SyntheticConfig",
    "_safe_parse_json",
    "call_llm",
    "call_llm_json",
    "call_llm_stream",
    "decrypt_api_key",
    "encrypt_api_key",
    "get_catalog",
    "get_models_for",
    "infer_provider_name",
    "match_provider",
    "get_env_fallback_state",
    "set_env_fallback_state",
]


async def call_llm(messages, *, purpose, client, router, log_worker,
                   user_id=None, record_id=None, case_id=None,
                   log_meta=None, temperature=0.7, max_tokens=512,
                   timeout=30, max_retries=2, response_format=None):
    from infrastructure.llm.client import CallContext, LLMClient
    llm = LLMClient(client, router, log_worker)
    ctx = CallContext(
        purpose=purpose, user_id=user_id, record_id=record_id,
        case_id=case_id, log_meta=log_meta,
    )
    return await llm.call(
        messages, purpose=purpose, temperature=temperature,
        max_tokens=max_tokens, timeout=timeout, max_retries=max_retries,
        response_format=response_format, ctx=ctx,
    )


async def call_llm_json(messages, *, purpose, client, router, log_worker,
                        user_id=None, record_id=None, case_id=None,
                        log_meta=None, temperature=0.3, max_tokens=2048,
                        timeout=120, max_retries=3, response_format=None):
    from infrastructure.llm.client import CallContext, LLMClient
    llm = LLMClient(client, router, log_worker)
    ctx = CallContext(
        purpose=purpose, user_id=user_id, record_id=record_id,
        case_id=case_id, log_meta=log_meta,
    )
    return await llm.call_json(
        messages, purpose=purpose, temperature=temperature,
        max_tokens=max_tokens, timeout=timeout, max_retries=max_retries,
        response_format=response_format, ctx=ctx,
    )


async def call_llm_stream(messages, *, purpose, client, router, log_worker,
                          user_id=None, record_id=None, case_id=None,
                          log_meta=None, temperature=0.7, max_tokens=512,
                          timeout=30, max_retries=2):
    from infrastructure.llm.client import CallContext, LLMClient
    llm = LLMClient(client, router, log_worker)
    ctx = CallContext(
        purpose=purpose, user_id=user_id, record_id=record_id,
        case_id=case_id, log_meta=log_meta,
    )
    async for chunk in llm.stream(
        messages, purpose=purpose, temperature=temperature,
        max_tokens=max_tokens, timeout=timeout, max_retries=max_retries,
        ctx=ctx,
    ):
        yield chunk
