import asyncio
import logging
from collections import defaultdict

log = logging.getLogger(__name__)


class RealtimeHub:
    """In-process fan-out of realtime events to a user's active WS connections.

    Events are queued as plain ``dict`` payloads (``{"type": ..., **data}``)
    and delivered verbatim over the training WebSocket. No SSE framing.
    """

    def __init__(self):
        self._subscribers: dict[int, list[asyncio.Queue]] = defaultdict(list)

    async def subscribe(self, user_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._subscribers[user_id].append(queue)
        log.debug("realtime subscriber: user_id=%d total=%d", user_id, len(self._subscribers[user_id]))
        return queue

    def unsubscribe(self, user_id: int, queue: asyncio.Queue):
        try:
            self._subscribers[user_id].remove(queue)
            if not self._subscribers[user_id]:
                del self._subscribers[user_id]
        except (ValueError, KeyError):
            pass

    async def publish(self, user_id: int, event_type: str, data: dict):
        event = {"type": event_type, **data}
        subscribers = self._subscribers.get(user_id, [])
        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # 队列满时丢弃最旧一条再入队，保留订阅（避免整条实时通道静默失联，
                # 否则消费者会一直卡在 queue.get() 收不到 scoring_complete 等事件）。
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    log.warning("realtime queue overflow, event dropped: user_id=%d type=%s", user_id, event_type)

    @property
    def stats(self) -> dict:
        """Connection stats for ops diagnostics."""
        total = 0
        for queues in self._subscribers.values():
            total += len(queues)
        return {
            "total_connections": total,
            "unique_users": len(self._subscribers),
        }
