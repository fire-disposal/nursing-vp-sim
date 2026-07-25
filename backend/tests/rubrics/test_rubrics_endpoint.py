"""Rubrics endpoint and load_rubric mtime hot-reload tests."""

import json
import time
from pathlib import Path


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestRubricsEndpoint:
    def test_current_rubric_with_score_review_permission(self, client, teacher):
        """GET /api/rubrics/current returns rubric data for teacher (score_review)."""
        _, token = teacher
        resp = client.get("/api/rubrics/current", headers=_auth_headers(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["id"] == "nursing_history_v1"
        assert "dimensions" in data
        assert isinstance(data["dimensions"], list)
        assert len(data["dimensions"]) > 0
        for dim in data["dimensions"]:
            assert "id" in dim
            assert "items" in dim
            assert isinstance(dim["items"], list)

    def test_current_rubric_no_permission_returns_403(self, client, student):
        """GET /api/rubrics/current returns 403 for student without score_review."""
        _, token = student
        resp = client.get("/api/rubrics/current", headers=_auth_headers(token))
        assert resp.status_code == 403

    def test_current_rubric_unauthenticated_returns_401(self, client):
        """GET /api/rubrics/current returns 401 without token."""
        resp = client.get("/api/rubrics/current")
        assert resp.status_code == 401


class TestLoadRubricHotReload:
    def test_load_rubric_caches_by_mtime(self, tmp_path):
        """load_rubric returns cached data when mtime unchanged."""
        from profiles.rubric_loader import _CACHE, load_rubric

        rubric_json = tmp_path / "rubric.json"
        rubric_data = {"id": "test_v1", "name": "test", "dimensions": []}
        with open(rubric_json, "w", encoding="utf-8") as f:
            json.dump(rubric_data, f)

        import profiles.rubric_loader as mod

        orig_path = mod._RUBRIC_JSON_PATH
        mod._RUBRIC_JSON_PATH = rubric_json
        _CACHE.clear()
        try:
            result1 = load_rubric("test_v1")
            assert result1 == rubric_data
            result2 = load_rubric("test_v1")
            assert result2 is result1
        finally:
            mod._RUBRIC_JSON_PATH = orig_path
            _CACHE.clear()

    def test_load_rubric_reloads_on_mtime_change(self, tmp_path):
        """load_rubric reloads data when mtime changes."""
        from profiles.rubric_loader import _CACHE, load_rubric

        rubric_json = tmp_path / "rubric.json"
        rubric_data_v1 = {"id": "test_v1", "name": "v1", "version": "1.0", "dimensions": []}
        rubric_data_v2 = {"id": "test_v1", "name": "v2", "version": "2.0", "dimensions": []}
        with open(rubric_json, "w", encoding="utf-8") as f:
            json.dump(rubric_data_v1, f)

        import profiles.rubric_loader as mod

        orig_path = mod._RUBRIC_JSON_PATH
        mod._RUBRIC_JSON_PATH = rubric_json
        _CACHE.clear()
        try:
            result1 = load_rubric("test_v1")
            assert result1["name"] == "v1"
            time.sleep(0.01)
            with open(rubric_json, "w", encoding="utf-8") as f:
                json.dump(rubric_data_v2, f)
            result2 = load_rubric("test_v1")
            assert result2["name"] == "v2"
            assert result2["version"] == "2.0"
        finally:
            mod._RUBRIC_JSON_PATH = orig_path
            _CACHE.clear()

    def test_load_rubric_file_not_found(self):
        """load_rubric raises FileNotFoundError when json missing."""
        import pytest

        import profiles.rubric_loader as mod
        from profiles.rubric_loader import _CACHE, load_rubric

        orig_path = mod._RUBRIC_JSON_PATH
        mod._RUBRIC_JSON_PATH = Path("/nonexistent/rubric.json")
        _CACHE.clear()
        try:
            with pytest.raises(FileNotFoundError):
                load_rubric()
        finally:
            mod._RUBRIC_JSON_PATH = orig_path
            _CACHE.clear()

    def test_rubric_py_loads_from_json(self):
        """profiles.history_taking.rubric.RUBRIC loads from rubric.json."""
        from profiles.history_taking.rubric import RUBRIC

        assert isinstance(RUBRIC, dict)
        assert RUBRIC["id"] == "nursing_history_v1"
        assert "dimensions" in RUBRIC
        assert len(RUBRIC["dimensions"]) == 2
