"""`query_scenario` 的聚合口径（`/api/diagnose` 的 `scenario` 分区唯一取数来源）。

为什么值得单独钉：这段 SQL 用 jsonb `FILTER` + `jsonb_array_elements_text` 区分
「DM 调用失败」（`dm_provider_error:*` / `dm_parse:*` / `dm_truncated:*`）与
「走了保底回合」（`dm_fallback`），并用 24h 窗口切时间；写错不会报错，只会静默给错数。
限流命中数则必须只认 `scenario.rate_limited` 这一类审计动作。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from infra.ops_queries import query_scenario
from models.audit import AuditLog
from models.scenario_training import StEvent, StGeneratedAsset, StSession

NOW = datetime.now(UTC)
OLD = NOW - timedelta(hours=30)


def _session(db, *, status: str, created_at: datetime) -> StSession:
    row = StSession(user_id=4242, pack_key="sputum-ineffective", pack_revision_id=1, status=status)
    row.created_at = created_at
    row.updated_at = created_at
    db.add(row)
    db.flush()
    return row


def _dm_turn(db, session_id: int, seq: int, problems: list[str], created_at: datetime) -> None:
    row = StEvent(session_id=session_id, seq=seq, kind="dm_turn", payload={"problems": problems})
    row.created_at = created_at
    db.add(row)


def _dm_step(db, session_id: int, seq: int, created_at: datetime) -> None:
    row = StEvent(
        session_id=session_id,
        seq=seq,
        kind="dm_step",
        payload={"turn": 1, "step": 1, "tool": "world.state", "args": {}, "ok": True, "ms": 3},
    )
    row.created_at = created_at
    db.add(row)


def _image(db, session_id: int, created_at: datetime, sha_seed: int) -> None:
    row = StGeneratedAsset(
        session_id=session_id,
        pack_key="sputum-ineffective",
        pack_revision_id=1,
        kind="image",
        prompt="夜班病房",
        mime_type="image/webp",
        file_size=10,
        sha256=f"{sha_seed:064d}",
        content=b"x",
    )
    row.created_at = created_at
    row.updated_at = created_at
    db.add(row)


def _audit(db, action: str, created_at: datetime) -> None:
    row = AuditLog(action=action, target_type="scenario", outcome="denied", payload={})
    row.created_at = created_at
    db.add(row)


def test_counts_24h_events_and_distinguishes_failure_from_fallback(pg_session) -> None:
    db = pg_session
    fresh = _session(db, status="active", created_at=NOW - timedelta(hours=1))
    done = _session(db, status="completed", created_at=NOW - timedelta(hours=2))
    stale = _session(db, status="completed", created_at=OLD)  # 窗口外：开局/回合都不该计入

    _dm_turn(db, fresh.id, 1, [], NOW - timedelta(minutes=50))
    _dm_turn(db, fresh.id, 2, ["dm_parse:Expecting value"], NOW - timedelta(minutes=40))
    _dm_turn(db, fresh.id, 3, ["dm_provider_error:TimeoutError", "dm_fallback"], NOW - timedelta(minutes=30))
    _dm_turn(db, stale.id, 1, ["dm_fallback"], OLD)  # 窗口外

    _dm_step(db, fresh.id, 11, NOW - timedelta(minutes=45))
    _dm_step(db, fresh.id, 12, NOW - timedelta(minutes=44))
    _dm_step(db, stale.id, 13, OLD)  # 窗口外

    _image(db, fresh.id, NOW - timedelta(minutes=30), 1)
    _image(db, fresh.id, OLD, 2)  # 窗口外

    _audit(db, "scenario.rate_limited", NOW - timedelta(minutes=10))
    _audit(db, "scenario.rate_limited", NOW - timedelta(minutes=5))
    _audit(db, "access.denied", NOW - timedelta(minutes=5))  # 别的动作不算
    _audit(db, "scenario.rate_limited", OLD)  # 窗口外
    db.flush()

    result = query_scenario(db, NOW - timedelta(hours=24))

    assert result["opened_24h"] == 2  # fresh + done（stale 在窗口外）
    assert result["active"] == 1
    assert result["completed"] == 2  # 即时状态计数：不受 24h 窗口影响
    assert result["turns_24h"] == 3
    assert result["llm_failures_24h"] == 2  # dm_parse + dm_provider_error
    assert result["fallbacks_24h"] == 1  # 只有窗口内那一条
    assert result["generated_images_24h"] == 1
    assert result["dm_steps_24h"] == 2  # 窗口内的两步；窗口外那条不计
    assert result["dm_avg_steps_24h"] == 0.67  # 2 步 / 3 个 dm_turn
    assert result["rate_limited_24h"] == 2


def test_empty_tables_give_zeroed_shape(pg_session) -> None:
    """没有情境数据时给确定的零值形状（消费方不必判空）。"""
    result = query_scenario(pg_session, NOW - timedelta(hours=24))

    assert result == {
        "opened_24h": 0,
        "active": 0,
        "completed": 0,
        "turns_24h": 0,
        "llm_failures_24h": 0,
        "fallbacks_24h": 0,
        "generated_images_24h": 0,
        "dm_steps_24h": 0,
        "dm_avg_steps_24h": 0.0,
        "rate_limited_24h": 0,
    }
