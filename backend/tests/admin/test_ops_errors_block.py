"""运维仪表盘的 `errors` 块必须带分组（下钻契约）。

`/admin/ops/dashboard` 的 `errors.groups` 是运维页「点击指纹进错误组详情」的唯一
证据来源：它必须来自 `get_error_context()`（档案 + 未落盘增量），而不是 `recent`
（内存最后 20 条）——后者会让刷新后仍然存在的错误组打不开。

这里只测块构造：`admin_ops_dashboard` 需要真实 DB 与鉴权，端点层由前端下钻测试覆盖。
"""

from __future__ import annotations

from infra.diagnose import _backend_group
from infra.error_buffer import ErrorGroup


def _group(fingerprint: str = "fp-1") -> ErrorGroup:
    return ErrorGroup(
        fingerprint=fingerprint,
        count=3,
        first_seen="2026-11-10T08:00:00+00:00",
        last_seen="2026-11-10T08:10:00+00:00",
        first_event={"level": "ERROR", "logger": "tests.worker", "message": "boom"},
        latest_event={"level": "ERROR", "logger": "tests.worker", "message": "boom later"},
        events=[
            {"message": "boom"},
            {"message": "boom later"},
            {"message": "boom later"},
        ],
    )


def test_backend_group_projection_keeps_variants_and_bounds():
    """分组投影：最近消息 + 去重变体 + 首末时间，供详情页原样展示。"""
    projection = _backend_group(_group())
    assert projection["fingerprint"] == "fp-1"
    assert projection["level"] == "ERROR"
    assert projection["logger"] == "tests.worker"
    assert projection["message"] == "boom later"
    assert projection["messages"] == ["boom", "boom later"]
    assert projection["count"] == 3
    assert projection["first_seen"] == "2026-11-10T08:00:00+00:00"
    assert projection["last_seen"] == "2026-11-10T08:10:00+00:00"


def test_error_context_window_labels_align_with_admin_block():
    """admin 块的 window 标签（rolling_60m）必须与分组查询的分钟数一致。"""
    from infra.diagnostics import TELEMETRY_WINDOW_LABEL

    assert TELEMETRY_WINDOW_LABEL == "rolling_60m"
    assert int(TELEMETRY_WINDOW_LABEL.removeprefix("rolling_").removesuffix("m")) == 60


def test_fingerprint_is_stable_for_variant_messages():
    """同指纹的不同消息变体必须落在同一 fingerprint 上（详情页据此归组）。"""
    from infra.error_buffer import fingerprint

    a = fingerprint("tests.worker", message="TimeoutError: slow\n\n  retry failed", head=300)
    b = fingerprint("tests.worker", message="TimeoutError: slow retry failed", head=300)
    assert a == b == "c7d2ac8d75481c8b"
