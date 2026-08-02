"""Unit tests for config validation and logging — monkeypatches module globals."""

import pytest

from core import config


class TestValidateConfig:
    def test_passes_with_valid_env(self, monkeypatch):
        monkeypatch.setattr(config, "JWT_SECRET_KEY", "x" * 32)
        monkeypatch.setattr(config, "DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
        monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "sk-test-placeholder")
        monkeypatch.setattr(config, "CORS_ORIGINS", "http://localhost:3000")
        config.validate_config()  # should not raise

    def test_raises_without_jwt_secret(self, monkeypatch):
        monkeypatch.setattr(config, "JWT_SECRET_KEY", "")
        with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"):
            config.validate_config()

    def test_raises_on_bad_database_url(self, monkeypatch):
        monkeypatch.setattr(config, "JWT_SECRET_KEY", "x" * 32)
        monkeypatch.setattr(config, "DATABASE_URL", "not-a-url")
        monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "sk-test-placeholder")
        with pytest.raises(RuntimeError, match="DATABASE_URL"):
            config.validate_config()

    def test_raises_on_non_postgres_scheme(self, monkeypatch):
        monkeypatch.setattr(config, "JWT_SECRET_KEY", "x" * 32)
        monkeypatch.setattr(config, "DATABASE_URL", "mysql://user:pass@localhost/db")
        monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "sk-test-placeholder")
        with pytest.raises(RuntimeError, match="scheme"):
            config.validate_config()

    def test_raises_without_deepseek_key(self, monkeypatch):
        monkeypatch.setattr(config, "JWT_SECRET_KEY", "x" * 32)
        monkeypatch.setattr(config, "DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
        monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "")
        with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
            config.validate_config()

    def test_raises_on_key_not_starting_sk(self, monkeypatch):
        monkeypatch.setattr(config, "JWT_SECRET_KEY", "x" * 32)
        monkeypatch.setattr(config, "DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
        monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "my-key")
        with pytest.raises(RuntimeError, match="sk-"):
            config.validate_config()

    def test_skip_key_accepted(self, monkeypatch):
        monkeypatch.setattr(config, "JWT_SECRET_KEY", "x" * 32)
        monkeypatch.setattr(config, "DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
        monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "skip")
        config.validate_config()  # should not raise


class TestLogConfig:
    def test_logs_sanitized_values(self, monkeypatch):
        monkeypatch.setattr(config, "JWT_SECRET_KEY", "supersecretkey12345")
        monkeypatch.setattr(config, "DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
        monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "sk-abcdef123456")
        monkeypatch.setattr(config, "DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        monkeypatch.setattr(config, "DIAGNOSE_TOKEN", "")

        records: list[str] = []

        class _Logger:
            def info(self, msg, *args):
                records.append(msg % args if args else msg)

        config.log_config(_Logger())

        joined = "\n".join(records)
        assert "postgresql://user:***@localhost:5432/db" in joined
        assert "user:pass" not in joined  # password never printed verbatim
        assert "***2345" in joined  # jwt tail visible, full secret not
        assert "sk-abcdef123456" not in joined  # full key never printed
        assert "未配置" in joined  # DIAGNOSE_TOKEN absent
