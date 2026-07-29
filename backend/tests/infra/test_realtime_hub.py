import asyncio
import json
import queue

import pytest

from infra.realtime_hub import PgRealtimeHub


@pytest.mark.asyncio
async def test_publish_enqueues_remote_without_sync_db_io(monkeypatch):
    hub = PgRealtimeHub(dsn="postgresql://example")

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("publish must not perform sync PG NOTIFY on caller path")

    monkeypatch.setattr(hub, "_publish_remote", fail_if_called)

    subscriber = await hub.subscribe(1)
    await hub.publish(1, "scoring_progress", {"record_id": 7})

    assert await asyncio.wait_for(subscriber.get(), timeout=0.1) == {
        "type": "scoring_progress",
        "record_id": 7,
    }
    channel, payload = hub._notify_queue.get_nowait()
    assert channel == "realtime_1"
    assert json.loads(payload) == {"type": "scoring_progress", "record_id": 7}


@pytest.mark.asyncio
async def test_publish_drops_only_remote_when_notify_queue_full():
    hub = PgRealtimeHub(dsn="postgresql://example")
    hub._notify_queue = queue.Queue(maxsize=1)
    hub._notify_queue.put_nowait(("realtime_1", "{}"))

    subscriber = await hub.subscribe(1)
    await hub.publish(1, "scoring_progress", {"record_id": 8})

    assert await asyncio.wait_for(subscriber.get(), timeout=0.1) == {
        "type": "scoring_progress",
        "record_id": 8,
    }
    assert hub.stats["notify_dropped"] == 1
    assert hub.stats["notify_queue"] == 1


def test_notify_loop_reuses_one_connection(monkeypatch):
    connects = []
    executed = []
    closed = []

    class FakeConnection:
        def execute(self, query, params=None):
            executed.append((query, params))

        def close(self):
            closed.append(True)

    def fake_connect(*_args, **_kwargs):
        conn = FakeConnection()
        connects.append(conn)
        return conn

    monkeypatch.setattr("infra.realtime_hub.psycopg.connect", fake_connect)

    hub = PgRealtimeHub(dsn="postgresql://example")
    hub._notify_queue.put_nowait(("realtime_1", '{"type":"a"}'))
    hub._notify_queue.put_nowait(("realtime_2", '{"type":"b"}'))

    hub._notify_loop()

    assert len(connects) == 1
    assert len(executed) == 2
    assert executed[0][1] is None
    assert executed[1][1] is None
    assert len(closed) == 1
