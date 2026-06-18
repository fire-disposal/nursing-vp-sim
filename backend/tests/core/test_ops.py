"""Tests for Ops API dashboard and errors endpoints."""
from unittest.mock import patch


def test_ops_dashboard_hidden_without_token(client):
    resp = client.get("/api/ops/dashboard")
    assert resp.status_code in (403, 404)


def test_ops_dashboard_with_valid_token(client):
    with patch("routers.ops._DIAGNOSE_TOKEN", "test-token"):
        resp = client.get("/api/ops/dashboard?token=test-token")
        assert resp.status_code == 200
        data = resp.json()
        assert "health" in data
        assert "llm" in data


def test_ops_dashboard_invalid_token(client):
    with patch("routers.ops._DIAGNOSE_TOKEN", "test-token"):
        resp = client.get("/api/ops/dashboard?token=wrong-token")
        assert resp.status_code == 403


def test_ops_errors_with_valid_token(client):
    with patch("routers.ops._DIAGNOSE_TOKEN", "test-token"):
        resp = client.get("/api/ops/errors?token=test-token")
        assert resp.status_code == 200
        data = resp.json()
        assert "count" in data
        assert "recent" in data
