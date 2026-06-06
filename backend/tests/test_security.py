import os

os.environ["SECRET_KEY"] = "test-secret-key-for-testing-only"

from datetime import UTC, datetime, timedelta

import jwt
import pytest

from core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY
from core.security import create_access_token, hash_password, verify_password


class TestHashPassword:
    def test_returns_bcrypt_hash(self):
        result = hash_password("mypassword")
        assert isinstance(result, str)
        assert result.startswith("$2b$")

    def test_different_calls_produce_different_hashes(self):
        h1 = hash_password("mypassword")
        h2 = hash_password("mypassword")
        assert h1 != h2

    def test_empty_password(self):
        result = hash_password("")
        assert isinstance(result, str)
        assert result.startswith("$2b$")


class TestVerifyPassword:
    def test_correct_password_verifies(self):
        hashed = hash_password("secret123")
        assert verify_password("secret123", hashed) is True

    def test_wrong_password_fails(self):
        hashed = hash_password("secret123")
        assert verify_password("wrongpass", hashed) is False

    def test_empty_password_verify(self):
        hashed = hash_password("")
        assert verify_password("", hashed) is True
        assert verify_password("x", hashed) is False


class TestCreateAccessToken:
    def test_returns_jwt_string(self):
        token = create_access_token({"user_id": 1})
        assert isinstance(token, str)
        parts = token.split(".")
        assert len(parts) == 3

    def test_decodes_with_same_secret_key(self):
        token = create_access_token({"user_id": 42, "role": "student"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["user_id"] == 42
        assert payload["role"] == "student"

    def test_includes_exp_claim(self):
        token = create_access_token({"user_id": 1})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert "exp" in payload
        exp = datetime.fromtimestamp(payload["exp"], tz=UTC)
        expected = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        delta = abs((exp - expected).total_seconds())
        assert delta < 5

    def test_different_secret_key_fails(self):
        token = create_access_token({"user_id": 1})
        with pytest.raises(jwt.PyJWTError):
            jwt.decode(token, "wrong-secret-key", algorithms=["HS256"])

    def test_empty_data(self):
        token = create_access_token({})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert "exp" in payload


class TestEndToEnd:
    def test_hash_and_verify(self):
        password = "e2e-test-password"
        hashed = hash_password(password)
        assert verify_password(password, hashed) is True
        assert verify_password("not-the-password", hashed) is False

    def test_create_token_and_verify_claims(self):
        data = {"user_id": 99, "scope": "admin"}
        token = create_access_token(data)
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["user_id"] == 99
        assert payload["scope"] == "admin"
        assert "exp" in payload
