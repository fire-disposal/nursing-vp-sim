"""Tests for notification endpoints."""

from models import Notification


def test_mark_notification_read_requires_auth(client):
    resp = client.put("/api/training/notifications/1/read")
    assert resp.status_code == 401


def test_mark_notification_read_nonexistent(client, teacher):
    _, token = teacher
    resp = client.put(
        "/api/training/notifications/99999/read",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


def test_mark_all_read_requires_auth(client):
    resp = client.put("/api/training/notifications/read-all")
    assert resp.status_code == 401


def test_mark_all_read_route_resolves(client, teacher, db_session):
    """Regression: /notifications/read-all must not be captured by /{notif_id}/read.

    Route ordering bug caused FastAPI to parse "read-all" as an int path
    param, returning 422 instead of marking notifications read.
    """
    user, token = teacher
    for i in range(2):
        db_session.add(Notification(user_id=user.id, type="scoring_complete", title=f"通知{i}", body="x"))
    db_session.commit()

    resp = client.put(
        "/api/training/notifications/read-all",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200

    remaining = (
        db_session.query(Notification).filter(Notification.user_id == user.id, Notification.is_read == False).count()
    )
    assert remaining == 0


def test_mark_single_notification_read(client, teacher, db_session):
    user, token = teacher
    notif = Notification(user_id=user.id, type="scoring_complete", title="单条", body="x")
    db_session.add(notif)
    db_session.commit()
    db_session.refresh(notif)

    resp = client.put(
        f"/api/training/notifications/{notif.id}/read",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200

    db_session.refresh(notif)
    assert notif.is_read is True


def test_mark_notification_unread(client, teacher, db_session):
    user, token = teacher
    notif = Notification(user_id=user.id, type="scoring_complete", title="已读后标回未读", body="x", is_read=True)
    db_session.add(notif)
    db_session.commit()
    db_session.refresh(notif)

    resp = client.put(
        f"/api/training/notifications/{notif.id}/unread",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200

    db_session.refresh(notif)
    assert notif.is_read is False


def test_mark_notification_unread_requires_auth(client):
    resp = client.put("/api/training/notifications/1/unread")
    assert resp.status_code == 401


def test_mark_notification_unread_nonexistent(client, teacher):
    _, token = teacher
    resp = client.put(
        "/api/training/notifications/99999/unread",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


import pytest

pytestmark = pytest.mark.integration
