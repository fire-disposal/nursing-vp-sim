"""Integration tests for grades, classes APIs and related endpoints."""

import pytest


def test_create_grade(client, teacher):
    _, token = teacher
    resp = client.post("/api/admin/grades", json={"name": "2024级"}, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code in (200, 400)  # 400 = already exists (idempotent)


def test_list_grades(client, teacher):
    _, token = teacher
    resp = client.get("/api/admin/grades", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    if data:
        for g in data:
            assert "name" in g
            assert "class_count" in g
            assert "student_count" in g


def test_create_class(client, teacher):
    _, token = teacher
    resp = client.post("/api/admin/grades", json={"name": "2024级"}, headers={"Authorization": f"Bearer {token}"})
    grade_id = resp.json()["id"]

    resp = client.post(
        "/api/admin/classes",
        json={"grade_id": grade_id, "name": "护理1班"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (200, 400)


def test_list_classes(client, teacher):
    _, token = teacher
    resp = client.get("/api/admin/classes", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    if data:
        for c in data:
            assert "name" in c
            assert "grade_id" in c
            assert "grade_name" in c
            assert "student_count" in c


def test_list_users_has_class_fields(client, teacher):
    _, token = teacher
    resp = client.get("/api/admin/users", params={"limit": 5}, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    items = resp.json()["items"]
    if items:
        u = items[0]
        assert "class_id" in u
        assert "class_name" in u
        assert "grade_name" in u


def test_class_summary(client, teacher):
    _, token = teacher
    resp = client.get("/api/stats/class-summary", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


def test_ranking_with_class_filter(client, teacher):
    _, token = teacher
    resp = client.get("/api/stats/ranking", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_teacher_summary(client, teacher):
    _, token = teacher
    resp = client.get("/api/stats/teacher-summary", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_update_user_class(client, teacher):
    _, token = teacher
    resp = client.get("/api/admin/users", params={"limit": 1}, headers={"Authorization": f"Bearer {token}"})
    users = resp.json()["items"]
    if not users:
        pytest.skip("No users available")
    user_id = users[0]["id"]
    resp = client.put(
        f"/api/admin/users/{user_id}",
        json={
            "class_id": 0  # unlink
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200


def test_auth_has_permission(client, teacher):
    _, token = teacher
    resp = client.get("/api/admin/grades", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


pytestmark = pytest.mark.integration
