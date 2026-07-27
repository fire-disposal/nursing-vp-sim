"""Unified application exception hierarchy with structured error codes."""

import logging
from enum import StrEnum

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)


class ErrorCode(StrEnum):
    """Machine-readable error codes for client-side handling."""

    # 4xx — client errors
    AUTH_INVALID = "AUTH_INVALID"
    AUTH_EXPIRED = "AUTH_EXPIRED"
    AUTH_FORBIDDEN = "AUTH_FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    VALIDATION = "VALIDATION"
    RATE_LIMITED = "RATE_LIMITED"

    # 5xx — server errors
    LLM_UNAVAILABLE = "LLM_UNAVAILABLE"
    LLM_CONCURRENCY = "LLM_CONCURRENCY"
    LLM_PARSE = "LLM_PARSE"
    LLM_RATE_LIMITED = "LLM_RATE_LIMITED"
    SCORING_FAILED = "SCORING_FAILED"
    SCORING_VALIDATION = "SCORING_VALIDATION"
    SCORING_FEEDBACK = "SCORING_FEEDBACK"
    INTERNAL = "INTERNAL"


class AppError(Exception):
    """Base for all application-level exceptions."""


class AuthError(HTTPException):
    """Authentication (401) or authorization (403) failure."""

    def __init__(
        self, detail: str = "认证失败", status_code: int = 401, error_code: ErrorCode = ErrorCode.AUTH_INVALID
    ):
        self.error_code = error_code
        super().__init__(status_code=status_code, detail=detail)


class NotFoundError(HTTPException):
    """Requested resource does not exist."""

    def __init__(self, detail: str = "资源不存在", error_code: ErrorCode = ErrorCode.NOT_FOUND):
        self.error_code = error_code
        super().__init__(status_code=404, detail=detail)


class ConflictError(HTTPException):
    """Resource state conflict (e.g., duplicate, already processed)."""

    def __init__(self, detail: str = "资源冲突", error_code: ErrorCode = ErrorCode.CONFLICT):
        self.error_code = error_code
        super().__init__(status_code=409, detail=detail)


class ValidationError(HTTPException):
    """Business-rule validation failure (400)."""

    def __init__(self, detail: str = "参数校验失败", error_code: ErrorCode = ErrorCode.VALIDATION):
        self.error_code = error_code
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


async def _log_and_respond(request: Request, status_code: int, detail: str, exc: Exception | None = None):
    error_code = getattr(exc, "error_code", None)
    if status_code >= 500:
        log.error(
            "%s %s → %d [%s] %s", request.method, request.url.path, status_code, error_code or "-", detail, exc_info=exc
        )
    else:
        log.warning("%s %s → %d [%s] %s", request.method, request.url.path, status_code, error_code or "-", detail)
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail, "error_code": error_code.value if error_code else None},
    )


async def auth_error_handler(request: Request, exc: AuthError):
    return await _log_and_respond(request, exc.status_code, exc.detail, exc)


async def not_found_handler(request: Request, exc: NotFoundError):
    return await _log_and_respond(request, exc.status_code, exc.detail, exc)


async def conflict_handler(request: Request, exc: ConflictError):
    return await _log_and_respond(request, exc.status_code, exc.detail, exc)


async def validation_error_handler(request: Request, exc: ValidationError):
    return await _log_and_respond(request, exc.status_code, exc.detail, exc)


async def llm_error_handler(request: Request, exc: LLMError):
    if isinstance(exc, (NoProviderAvailable, LLMConcurrencyExceeded)):
        status_code = 503
    elif isinstance(exc, LLMParseError):
        status_code = 502
    elif isinstance(exc, LLMRateLimited):
        status_code = 429
    else:
        status_code = 500
    return await _log_and_respond(request, status_code, str(exc), exc)


async def scoring_error_handler(request: Request, exc: ScoringError):
    if isinstance(exc, ScoringValidationError):
        status_code = 422
    elif isinstance(exc, ScoringFeedbackError):
        status_code = 500
    else:
        status_code = 500
    return await _log_and_respond(request, status_code, str(exc), exc)
