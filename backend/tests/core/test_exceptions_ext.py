"""Unit tests for exception handlers and error code vocabulary.

Uses a minimal FastAPI app + TestClient — no database involved.
"""

import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.exceptions import (
    AuthError,
    ConflictError,
    ErrorCode,
    LLMConcurrencyExceeded,
    LLMParseError,
    LLMRateLimited,
    NoProviderAvailable,
    NotFoundError,
    ScoringFeedbackError,
    ScoringValidationError,
    ValidationError,
    auth_error_handler,
    conflict_handler,
    llm_error_handler,
    log_error,
    not_found_handler,
    register_exception_handler,
    scoring_error_handler,
    validation_error_handler,
)


def _make_app(handler, exc_type) -> FastAPI:
    app = FastAPI()
    register_exception_handler(app, exc_type, handler)

    @app.get("/boom")
    async def boom():
        raise exc_type("测试错误")

    return app


class TestErrorCode:
    def test_members_have_values(self):
        assert ErrorCode.AUTH_INVALID == "AUTH_INVALID"
        assert ErrorCode.AUTH_EXPIRED == "AUTH_EXPIRED"
        assert ErrorCode.AUTH_FORBIDDEN == "AUTH_FORBIDDEN"
        assert ErrorCode.NOT_FOUND == "NOT_FOUND"
        assert ErrorCode.CONFLICT == "CONFLICT"
        assert ErrorCode.VALIDATION == "VALIDATION"
        assert ErrorCode.RATE_LIMITED == "RATE_LIMITED"
        assert ErrorCode.INTERNAL == "INTERNAL"

    def test_default_codes_on_exceptions(self):
        assert AuthError().error_code == ErrorCode.AUTH_INVALID
        assert NotFoundError().error_code == ErrorCode.NOT_FOUND
        assert ConflictError().error_code == ErrorCode.CONFLICT
        assert ValidationError().error_code == ErrorCode.VALIDATION


class TestHandlers:
    def test_auth_error_maps_to_401(self):
        app = _make_app(auth_error_handler, AuthError)
        resp = TestClient(app).get("/boom")
        assert resp.status_code == 401
        assert resp.json() == {"detail": "测试错误", "error_code": "AUTH_INVALID"}

    def test_not_found_maps_to_404(self):
        app = _make_app(not_found_handler, NotFoundError)
        resp = TestClient(app).get("/boom")
        assert resp.status_code == 404
        assert resp.json()["error_code"] == "NOT_FOUND"

    def test_conflict_maps_to_409(self):
        app = _make_app(conflict_handler, ConflictError)
        resp = TestClient(app).get("/boom")
        assert resp.status_code == 409
        assert resp.json()["error_code"] == "CONFLICT"

    def test_validation_maps_to_400(self):
        app = _make_app(validation_error_handler, ValidationError)
        resp = TestClient(app).get("/boom")
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "VALIDATION"

    def test_error_code_null_for_exceptions_without_code(self):
        # LLM errors carry no error_code → response field is null
        app = _make_app(llm_error_handler, LLMParseError)
        resp = TestClient(app).get("/boom")
        assert resp.status_code == 502
        assert resp.json()["error_code"] is None

    def test_llm_error_mapping(self):
        cases = [
            (NoProviderAvailable, 503),
            (LLMConcurrencyExceeded, 503),
            (LLMParseError, 502),
            (LLMRateLimited, 429),
        ]
        for exc_type, expected in cases:
            app = _make_app(llm_error_handler, exc_type)
            assert TestClient(app).get("/boom").status_code == expected

    def test_scoring_error_mapping(self):
        app = _make_app(scoring_error_handler, ScoringValidationError)
        assert TestClient(app).get("/boom").status_code == 422

        app = _make_app(scoring_error_handler, ScoringFeedbackError)
        assert TestClient(app).get("/boom").status_code == 500


class TestLogError:
    def test_logs_exception_with_extra(self, caplog):
        logger = logging.getLogger("test.exceptions")
        with caplog.at_level(logging.ERROR, logger="test.exceptions"):
            try:
                raise ValueError("boom")
            except ValueError:
                log_error(logger, "处理失败", extra={"record_id": 3})
        assert "处理失败" in caplog.text
        assert caplog.records[0].record_id == 3
