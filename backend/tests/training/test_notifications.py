"""Tests for notification endpoints."""


def test_mark_notification_read_requires_auth(client):
    resp = client.patch("/api/training/notifications/1")
    assert resp.status_code == 401


def test_mark_notification_read_nonexistent(client, teacher):
    _, token = teacher
    resp = client.patch(
        "/api/training/notifications/99999",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
