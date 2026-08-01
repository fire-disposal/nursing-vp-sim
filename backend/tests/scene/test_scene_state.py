"""Characterization tests for scene state seeding (D-1).

runtime_state["scene"] is a backend-internal detail — not exposed via API.
Tests verify the DB-level seeding by querying the record directly.
Physical exam REST endpoint was removed in Batch 0 (now WS-only).
"""

from models import TrainingRecord


class TestSceneStateSeeding:
    """D-1: runtime_state["scene"] is seeded at training creation."""

    def test_seeded_via_http(self, client, student, test_case, db_session):
        """Start training via HTTP; verify scene in DB."""
        _, token = student
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id, "time_limit_minutes": 20, "features": {"physical_exam": True}},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, f"start failed: {resp.text}"
        record_id = resp.json()["record_id"]

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        assert record is not None, "record should exist"

        scene = (record.runtime_state or {}).get("scene", {})
        assert scene, "runtime_state.scene should be seeded"
        assert scene.get("environment", {}).get("type") == "ward"
        assert scene.get("patient", {}).get("consciousness") == "alert"
        assert scene.get("vitals") is not None


import pytest

pytestmark = pytest.mark.integration
