"""Unit tests for small pure helpers: pagination, datetime utils, statuses, rate-limit IP."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from core.datetime_utils import ensure_utc, parse_iso_datetime
from core.pagination import paginate
from core.rate_limits import _get_client_ip
from core.statuses import TrainingMode, TrainingStatus, normalize_training_mode


class _FakePagedQuery:
    def __init__(self, items: list):
        self._items = items
        self._offset = 0
        self._limit = 0

    def order_by(self, _clause):
        return self

    def count(self) -> int:
        return len(self._items)

    def offset(self, offset: int):
        self._offset = offset
        return self

    def limit(self, limit: int):
        self._limit = limit
        return self

    def all(self):
        return self._items[self._offset : self._offset + self._limit]


class TestPaginate:
    def test_returns_page_and_total(self):
        items, total = paginate(_FakePagedQuery(list(range(10))), 2, 3)
        assert items == [2, 3, 4]
        assert total == 10

    def test_empty_page(self):
        items, total = paginate(_FakePagedQuery([]), 0, 10)
        assert items == []
        assert total == 0


class TestParseIsoDatetime:
    def test_naive_string_treated_as_utc(self):
        dt = parse_iso_datetime("2026-07-01T12:00:00")
        assert dt.tzinfo == UTC
        assert dt.hour == 12

    def test_z_suffix_parsed(self):
        dt = parse_iso_datetime("2026-07-01T12:00:00Z")
        assert dt.tzinfo is not None
        assert dt.hour == 12

    def test_offset_converted(self):
        dt = parse_iso_datetime("2026-07-01T12:00:00+08:00")
        assert dt.utcoffset() == timedelta(hours=8)


class TestEnsureUtc:
    def test_naive_becomes_utc(self):
        dt = ensure_utc(datetime(2026, 7, 1, 12, 0, 0))  # noqa: DTZ001 — 故意传 naive 验证处理
        assert dt.tzinfo == UTC

    def test_aware_converted_to_utc(self):
        local = datetime(2026, 7, 1, 12, 0, 0, tzinfo=UTC).astimezone()
        converted = ensure_utc(local)
        assert converted.tzinfo == UTC
        assert converted == datetime(2026, 7, 1, 12, 0, 0, tzinfo=UTC)

    def test_utc_aware_unchanged(self):
        original = datetime(2026, 7, 1, 12, 0, 0, tzinfo=UTC)
        assert ensure_utc(original) is original


class TestTrainingMode:
    def test_valid_values(self):
        assert TrainingMode.GUIDED.value == "guided"
        assert TrainingMode.ASSESSMENT.value == "assessment"
        assert TrainingMode.BLIND_BOX.value == "blind_box"

    def test_normalize_keeps_valid(self):
        assert normalize_training_mode("assessment") == "assessment"

    def test_normalize_falls_back_for_invalid(self):
        assert normalize_training_mode("weird") == "guided"

    def test_normalize_falls_back_for_non_string(self):
        assert normalize_training_mode(None) == "guided"
        assert normalize_training_mode(123) == "guided"

    def test_training_status_values(self):
        assert TrainingStatus.COMPLETED.value == "completed"


class TestGetClientIp:
    def _request(self, headers: dict, client_host: str | None):
        return SimpleNamespace(
            headers=headers,
            client=SimpleNamespace(host=client_host) if client_host else None,
        )

    def test_direct_ip(self):
        assert _get_client_ip(self._request({}, "10.0.0.1")) == "10.0.0.1"

    def test_forwarded_header_takes_precedence(self):
        req = self._request({"X-Forwarded-For": "203.0.113.5, 10.0.0.1"}, "10.0.0.1")
        assert _get_client_ip(req) == "203.0.113.5"

    def test_real_ip_fallback(self):
        req = self._request({"X-Real-IP": "198.51.100.7"}, "10.0.0.1")
        assert _get_client_ip(req) == "198.51.100.7"

    def test_forwarded_beats_real_ip(self):
        req = self._request({"X-Forwarded-For": " 203.0.113.9 ", "X-Real-IP": "198.51.100.7"}, None)
        assert _get_client_ip(req) == "203.0.113.9"

    def test_no_client_returns_unknown(self):
        req = SimpleNamespace(headers={}, client=None)
        assert _get_client_ip(req) == "unknown"
