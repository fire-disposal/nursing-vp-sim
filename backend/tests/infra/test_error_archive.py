from datetime import UTC, datetime, timedelta

from infra.error_archive import ErrorArchive


def test_error_archive_survives_reopen_and_filters_window(tmp_path):
    path = tmp_path / "errors.jsonl"
    now = datetime.now(UTC)

    archive = ErrorArchive(str(path), max_bytes=1024 * 1024, backup_count=1)
    archive.append({"time": (now - timedelta(hours=2)).isoformat(), "fingerprint": "old", "count": 1})
    archive.append({"time": now.isoformat(), "fingerprint": "new", "count": 3})
    archive.close()

    reopened = ErrorArchive(str(path), max_bytes=1024 * 1024, backup_count=1)
    events = reopened.query(since=now - timedelta(minutes=5))
    reopened.close()

    assert [event["fingerprint"] for event in events] == ["new"]
    assert events[0]["count"] == 3


def test_error_archive_query_has_hard_limit(tmp_path):
    path = tmp_path / "errors.jsonl"
    now = datetime.now(UTC)
    archive = ErrorArchive(str(path), max_bytes=1024 * 1024, backup_count=1)
    for index in range(10):
        archive.append({"time": now.isoformat(), "fingerprint": str(index), "count": 1})

    events = archive.query(since=now - timedelta(minutes=1), limit=4)
    archive.close()

    assert len(events) == 4
