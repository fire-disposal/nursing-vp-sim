"""ASR graceful-degradation helpers.

ASR is a low-priority, possibly trial-only service. These helpers centralise
the "is ASR even usable?" decision so routers and startup can degrade cleanly
instead of erroring out and blocking the training flow.
"""


def asr_configured(api_key: str | None, resource_id: str | None) -> bool:
    """True only when both an API key and an ASR resource id are present."""
    return bool(api_key and api_key.strip()) and bool(resource_id and resource_id.strip())
