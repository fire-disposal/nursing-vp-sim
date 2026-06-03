"""integration tests for ApiSecret + LLMConfig CRUD endpoints"""

import pytest


class TestApiSecretCRUD:
    def test_create_and_list_secret(self, client, teacher):
        _, token = teacher

        resp = client.post(
            "/api/admin/api/secrets",
            json={
                "label": "Test Secret",
                "raw_key": "sk-test1234567890abcdef",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        secret_id = resp.json()["id"]

        resp = client.get("/api/admin/api/secrets", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        secrets = resp.json()
        assert any(s["id"] == secret_id for s in secrets)


class TestLLMConfigCRUD:
    @pytest.fixture
    def secret_id(self, client, teacher, db_session):
        from models import ApiSecret
        from services.crypto_utils import encrypt_api_key

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
        _, token = teacher

        resp = client.post(
            "/api/admin/api/configs",
            json={
                "secret_id": secret_id,
                "label": "QA-primary",
                "base_url": "https://api.test.com",
                "model": "test-model",
                "purpose": "qa",
                "priority": 10,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201

        resp2 = client.post(
            "/api/admin/api/configs",
            json={
                "secret_id": secret_id,
                "label": "QA-primary-duplicate",
                "base_url": "https://api.test.com",
                "model": "test-model-2",
                "purpose": "qa",
                "priority": 10,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 400

    def test_cannot_delete_secret_with_configs(self, client, teacher, secret_id, db_session):
        from models import LLMConfig

        _, token = teacher

        cfg = LLMConfig(
            secret_id=secret_id,
            label="block-delete",
            base_url="https://api.test.com",
            model="test-model",
            purpose="qa_block",
            priority=50,
        )
        db_session.add(cfg)
        db_session.commit()

        resp = client.delete(f"/api/admin/api/secrets/{secret_id}", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 400

    def test_can_delete_secret_without_configs(self, client, teacher, db_session):
        from models import ApiSecret
        from services.crypto_utils import encrypt_api_key

        _, token = teacher

        secret = ApiSecret(
            label="No Configs Secret",
            encrypted_key=encrypt_api_key("sk-test1234567890abcdef"),
            key_suffix="cdef",
        )
        db_session.add(secret)
        db_session.commit()
        db_session.refresh(secret)

        resp = client.delete(f"/api/admin/api/secrets/{secret.id}", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
