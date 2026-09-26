"""结构化日志字段的免库判据（2026-09-26 审计 §1.2 / OBS-1）。

缺陷背景：全仓 53 处 ``log.info(..., extra={"user_id": ...})``，但 formatter 的 format 串
里没有任何 ``%(user_id)s`` 占位符 → 这些字段**一个都不会输出**（``extra`` 只进 LogRecord，
不写进 format 就等于丢弃）。排查线上事故时拿不到"谁触发的"。

这里直接格式化一条 record 断言可观测结果，不检查实现细节。
"""

from __future__ import annotations

import logging

from infra.logging_setup import _ColoredFormatter


def _line(**extra: object) -> str:
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname=__file__, lineno=1, msg="用户更新", args=(), exc_info=None
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return _ColoredFormatter("%(levelname)s %(name)s %(message)s %(extra_fields)s").format(record)


def test_extra_fields_appear_in_line() -> None:
    line = _line(user_id=7, user_role="admin", request_id="req-abc")
    assert "user_id=7" in line
    assert "user_role=admin" in line
    assert "request_id=req-abc" in line


def test_missing_extra_does_not_break_and_omits_keys() -> None:
    line = _line()
    assert "用户更新" in line
    assert "user_id" not in line
    assert "request_id" not in line


def test_empty_values_are_omitted() -> None:
    line = _line(user_id=7, request_id="")
    assert "user_id=7" in line
    assert "request_id" not in line
