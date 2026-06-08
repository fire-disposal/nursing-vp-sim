import pytest

from core.exceptions import (
    AppError,
    AuthError,
    ConflictError,
    LLMConcurrencyExceeded,
    LLMError,
    LLMParseError,
    LLMRateLimited,
    NoProviderAvailable,
    NotFoundError,
    ScoringError,
    ScoringFeedbackError,
    ScoringValidationError,
)


class TestExceptionHierarchy:

    def test_app_error_is_base(self):
        assert issubclass(AuthError, AppError)
        assert issubclass(NotFoundError, AppError)
        assert issubclass(LLMError, AppError)
        assert issubclass(ScoringError, AppError)

    def test_llm_subclasses(self):
        assert issubclass(NoProviderAvailable, LLMError)
        assert issubclass(LLMConcurrencyExceeded, LLMError)
        assert issubclass(LLMParseError, LLMError)
        assert issubclass(LLMRateLimited, LLMError)

    def test_scoring_subclasses(self):
        assert issubclass(ScoringValidationError, ScoringError)
        assert issubclass(ScoringFeedbackError, ScoringError)

    def test_str_representation(self):
        exc = NoProviderAvailable("purpose=scoring")
        assert "scoring" in str(exc)

    def test_can_catch_by_base(self):
        with pytest.raises(AppError):
            raise NoProviderAvailable("test")
