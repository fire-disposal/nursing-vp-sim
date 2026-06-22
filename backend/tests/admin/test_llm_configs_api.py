"""integration tests for ApiSecret + LLMConfig CRUD endpoints"""

import pytest


class TestLLMConfigCRUD:
    @pytest.fixture
    def secret_id(self, client, teacher, db_session):
        from infrastructure.llm import encrypt_api_key
        from models import ApiSecret

        _, _token = teacher

        secret = ApiSecret(
            label="Test Secret",
            encrypted_key=encrypt_api_key("sk-test1234567890abcdef"),
            key_suffix="cdef",
        )
        db_session.add(secret)
        db_session.commit()
        db_session.refresh(secret)
        return secret.id

    def test_create_config_with_purpose_priority_conflict(self, client, teacher, secret_id):
        """same secret_id + purpose upserts: returns 201"""
        _, token = teacher

        resp = client.post(
            "/api/admin/api/configs",
            json={
                "secret_id": secret_id,
                "purpose": "qa",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        first_id = resp.json()["id"]

        resp2 = client.post(
            "/api/admin/api/configs",
            json={
                "secret_id": secret_id,
                "purpose": "qa",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 201
        assert resp2.json()["id"] == first_id
