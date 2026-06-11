"""Unified application exception hierarchy."""


class AppError(Exception):
    """Base for all application-level exceptions."""


class AuthError(AppError):
    """Authentication or authorization failure."""


class NotFoundError(AppError):
    """Requested resource does not exist."""


class ConflictError(AppError):
    """Resource state conflict (e.g., duplicate, already processed)."""


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
