"""Tests for the comprehensive /api/diagnose endpoint."""

from unittest.mock import patch


def test_diagnose_hidden_without_token(client):
    resp = client.get("/api/diagnose")
    assert resp.status_code in (403, 404)


def test_diagnose_with_valid_token(client):
    with patch("routers.ops.DIAGNOSE_TOKEN", "test-token"):
        resp = client.get("/api/diagnose?token=test-token")
        assert resp.status_code == 200
        data = resp.json()
        assert "version" in data
        assert "health" in data
        assert "llm" in data
        assert "scoring" in data
        assert "sessions" in data
        assert "voice" in data
        assert "errors" in data
        assert "alerts" in data
        assert "summary" in data
        # errors sub-structure
        assert "count" in data["errors"]
        assert "recent" in data["errors"]


def test_diagnose_invalid_token(client):
    with patch("routers.ops.DIAGNOSE_TOKEN", "test-token"):
        resp = client.get("/api/diagnose?token=wrong-token")
        assert resp.status_code == 403
