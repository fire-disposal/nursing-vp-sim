"""Unified application exception hierarchy."""

import logging

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)


class AppError(Exception):
    """Base for all application-level exceptions."""


# ── HTTP-aware custom exceptions ──


class AuthError(HTTPException):
    """Authentication (401) or authorization (403) failure."""

    def __init__(self, detail: str = "认证失败", status_code: int = 401):
        super().__init__(status_code=status_code, detail=detail)


class NotFoundError(HTTPException):
    """Requested resource does not exist."""

    def __init__(self, detail: str = "资源不存在"):
        super().__init__(status_code=404, detail=detail)


class ConflictError(HTTPException):
    """Resource state conflict (e.g., duplicate, already processed)."""

    def __init__(self, detail: str = "资源冲突"):
        super().__init__(status_code=409, detail=detail)


class ValidationError(HTTPException):
    """Business-rule validation failure (400)."""

    def __init__(self, detail: str = "请求无效"):
        super().__init__(status_code=400, detail=detail)


# ── LLM ──


class LLMError(AppError):
    """Base for all LLM-related errors."""


class NoProviderAvailable(LLMError):
    """All LLM providers exhausted, degraded, or unavailable."""


class LLMConcurrencyExceeded(LLMError):
    """Semaphore acquisition timed out — too many in-flight calls."""


class LLMParseError(LLMError):
    """JSON response parsing failed after all retries."""


class LLMRateLimited(LLMError):
    """Provider returned 429 after all retries."""


# ── Scoring ──


class ScoringError(AppError):
    """Base for scoring pipeline errors."""


class ScoringValidationError(ScoringError):
    """Scoring result failed structural validation."""


class ScoringFeedbackError(ScoringError):
    """Feedback generation returned empty or invalid result."""


# ── Exception handlers (for FastAPI add_exception_handler) ──


async def _log_and_respond(request: Request, status_code: int, detail: str):
    log.warning("%s %s → %d %s", request.method, request.url.path, status_code, detail)
    return JSONResponse(status_code=status_code, content={"detail": detail})


async def auth_error_handler(request: Request, exc: AuthError):
    return await _log_and_respond(request, exc.status_code, exc.detail)


async def not_found_handler(request: Request, exc: NotFoundError):
    return await _log_and_respond(request, exc.status_code, exc.detail)


async def conflict_handler(request: Request, exc: ConflictError):
    return await _log_and_respond(request, exc.status_code, exc.detail)


async def validation_error_handler(request: Request, exc: ValidationError):
    return await _log_and_respond(request, exc.status_code, exc.detail)


async def llm_error_handler(request: Request, exc: LLMError):
    if isinstance(exc, (NoProviderAvailable, LLMConcurrencyExceeded)):
        status_code = 503
    elif isinstance(exc, LLMParseError):
        status_code = 502
    elif isinstance(exc, LLMRateLimited):
        status_code = 429
    else:
        status_code = 500
    return await _log_and_respond(request, status_code, str(exc))


async def scoring_error_handler(request: Request, exc: ScoringError):
    if isinstance(exc, ScoringValidationError):
        status_code = 422
    elif isinstance(exc, ScoringFeedbackError):
        status_code = 500
    else:
        status_code = 500
    return await _log_and_respond(request, status_code, str(exc))
