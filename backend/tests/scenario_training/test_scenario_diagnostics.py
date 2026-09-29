"""`query_scenario` 的聚合口径（`/api/diagnose` 的 `scenario` 分区唯一取数来源）。

为什么值得单独钉：这段 SQL 从 jsonb 里取值（`payload ->> 'time_cost'`、`payload -> 'models' ->> …`）
并按 24h 窗口切时间——键名写错不会报错，只会静默给 0；分子（时间单位 / 模型调用）与分母
（`turn_committed` 事件）必须是同一群体同一窗口。LLM 失败没有世界事件，只能从
`llm_call_logs`（`st_intent` / `st_dm`）数；限流命中数则必须只认 `scenario.rate_limited` 审计动作。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from infra.ops_queries import query_scenario
from models.audit import AuditLog
from models.scenario_training import StEvent, StSession

NOW = datetime.now(UTC)
OLD = NOW - timedelta(hours=30)


def _session(db, *, status: str, created_at: datetime) -> StSession:
    row = StSession(user_id=4242, pack_key="sputum-ineffective", pack_version=1, pack_content={}, status=status)
    row.created_at = created_at
    row.updated_at = created_at
    db.add(row)
    db.flush()
    return row


def _committed_turn(
    db, session_id: int, seq: int, problems: list[str], created_at: datetime, *, time_cost: int = 0
) -> None:
    """一条**已提交回合**：新机制里一个业务回合一事件；`models` 与 `time_cost` 是成本口径。"""
    row = StEvent(
        session_id=session_id,
        seq=seq,
        kind="turn_committed",
        payload={
            "problems": problems,
            "turn": seq,
            "time_cost": time_cost,
            "outcome": "performed",
            "models": {"parse": 1, "delivery": 1},
        },
    )
    row.created_at = created_at
    db.add(row)


def _audit(db, action: str, created_at: datetime) -> None:
    row = AuditLog(action=action, target_type="scenario", outcome="denied", payload={})
    row.created_at = created_at
    db.add(row)


def test_counts_24h_requests_time_cost_and_model_calls(pg_session) -> None:
    """24h 口径：按**同一群体**（已提交请求事件）数请求、时间单位与模型调用；窗口外不计。"""
    db = pg_session
    fresh = _session(db, status="active", created_at=NOW - timedelta(minutes=50))
    stale = _session(db, status="completed", created_at=OLD)
    _committed_turn(db, fresh.id, 1, [], NOW - timedelta(minutes=50), time_cost=2)
    _committed_turn(
        db, fresh.id, 2, ["Expecting value: line 1 column 1 (char 0)"], NOW - timedelta(minutes=40), time_cost=0
    )
    _committed_turn(db, fresh.id, 3, ["intent_provider_error:TimeoutError"], NOW - timedelta(minutes=30), time_cost=3)
    _committed_turn(db, stale.id, 1, [], OLD, time_cost=9)  # 窗口外
    db.flush()

    result = query_scenario(db, day_ago=NOW - timedelta(hours=24))
    assert result["requests_24h"] == 3  # 窗口内三条已提交请求（同一群体分母）
    assert result["time_cost_24h"] == 5  # 2 + 0 + 3：情境时间单位，不是请求数
    assert result["model_calls_24h"] == 6  # 每条两个阶段各一次
    assert result["avg_time_cost_per_request_24h"] == round(5 / 3, 2)
    assert result["avg_model_calls_per_request_24h"] == round(6 / 3, 2)
    assert result["clarifications_24h"] == 0
    assert result["hints_24h"] == 0


def test_empty_tables_give_zeroed_shape(pg_session) -> None:
    """空表：字段名就是契约（前端看板与部署冒烟按名字对齐），计数为 0、比值为 null。"""
    result = query_scenario(pg_session, day_ago=NOW - timedelta(hours=24))
    # 这 12 个键就是 `query_scenario` 的完整形状：`scope`/`window`/`state_window` 由调用方
    # （`infra/diagnostics.py`、`modules/admin/ops.py`）在外层补上，不在这里。
    assert set(result) == {
        "opened_24h",
        "active",
        "completed",
        "requests_24h",
        "time_cost_24h",
        "avg_time_cost_per_request_24h",
        "model_calls_24h",
        "avg_model_calls_per_request_24h",
        "clarifications_24h",
        "hints_24h",
        "llm_failures_24h",
        "rate_limited_24h",
    }
    assert result["requests_24h"] == 0
    assert result["avg_time_cost_per_request_24h"] is None
    assert result["avg_model_calls_per_request_24h"] is None
