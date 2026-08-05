import logging
from datetime import UTC, datetime, timedelta

from infra.diagnose import DiagnoseService, ErrorCaptureHandler
from infra.error_archive import ErrorArchive


def _record(message: str, *, created: float) -> logging.LogRecord:
    record = logging.LogRecord("tests.worker", logging.ERROR, "", 0, message, (), None)
    record.created = created
    return record


def test_error_handler_deduplicates_and_tracks_count(tmp_path):
    archive = ErrorArchive(str(tmp_path / "errors.jsonl"), max_bytes=1024 * 1024, backup_count=1)
    handler = ErrorCaptureHandler(archive=archive)
    now = datetime.now(UTC).timestamp()

    handler.emit(_record("database timeout", created=now))
    handler.emit(_record("database timeout", created=now + 1))

    recent = handler.get_recent()
    archive.close()

    assert len(recent) == 1
    assert recent[0]["count"] == 2
    assert recent[0]["fingerprint"]


def test_error_context_merges_archive_and_unpersisted_delta(tmp_path):
    archive = ErrorArchive(str(tmp_path / "errors.jsonl"), max_bytes=1024 * 1024, backup_count=1)
    handler = ErrorCaptureHandler(archive=archive)
    service = DiagnoseService()
    service._archive = archive
    service._handler = handler
    now = datetime.now(UTC).timestamp()

    handler.emit(_record("database timeout", created=now))
    handler.emit(_record("database timeout", created=now + 1))

    context = service.get_error_context(minutes=5, max_groups=10)
    archive.close()

    assert context["total_events"] == 2
    assert context["unique_groups"] == 1
    assert context["groups"][0]["count"] == 2


def test_error_context_is_bounded(tmp_path):
    archive = ErrorArchive(str(tmp_path / "errors.jsonl"), max_bytes=1024 * 1024, backup_count=1)
    now = datetime.now(UTC)
    for index in range(8):
        archive.append(
            {
                "time": (now - timedelta(seconds=index)).isoformat(),
                "first_seen": now.isoformat(),
                "last_seen": now.isoformat(),
                "fingerprint": f"fp-{index}",
                "logger": "tests",
                "level": "ERROR",
                "message": f"error {index}",
                "count": 1,
            }
        )

    service = DiagnoseService()
    service._archive = archive
    context = service.get_error_context(minutes=5, max_groups=3)
    archive.close()

    assert len(context["groups"]) == 3
    assert context["truncated"] is True
