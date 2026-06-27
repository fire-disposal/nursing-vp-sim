import pytest
from fastapi import HTTPException

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
    def test_auth_error_is_http_exception(self):
        assert issubclass(AuthError, HTTPException)

    def test_not_found_is_http_exception(self):
        assert issubclass(NotFoundError, HTTPException)

    def test_conflict_is_http_exception(self):
        assert issubclass(ConflictError, HTTPException)

    def test_llm_error_is_app_error(self):
        assert issubclass(LLMError, AppError)

    def test_scoring_error_is_app_error(self):
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

    def test_llm_can_catch_by_app_error(self):
        with pytest.raises(AppError):
            raise NoProviderAvailable("test")

    def test_auth_has_default_detail(self):
        assert AuthError().detail == "认证失败"

    def test_not_found_has_default_detail(self):
        assert NotFoundError().detail == "资源不存在"

    def test_conflict_has_default_detail(self):
        assert ConflictError().detail == "资源冲突"

    def test_validation_error_is_400(self):
        from core.exceptions import ValidationError

        err = ValidationError("名称重复")
        assert err.status_code == 400
        assert err.detail == "名称重复"
