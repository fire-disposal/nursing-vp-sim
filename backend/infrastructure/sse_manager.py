import asyncio
import json
import logging
from collections import defaultdict

log = logging.getLogger(__name__)


class SSEManager:
    def __init__(self):
        self._subscribers: dict[int, list[asyncio.Queue]] = defaultdict(list)

    async def subscribe(self, user_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._subscribers[user_id].append(queue)
        log.debug("SSE subscriber: user_id=%d total=%d", user_id, len(self._subscribers[user_id]))
        return queue

    def unsubscribe(self, user_id: int, queue: asyncio.Queue):
        try:
            self._subscribers[user_id].remove(queue)
            if not self._subscribers[user_id]:
                del self._subscribers[user_id]
        except (ValueError, KeyError):
            pass

    async def publish(self, user_id: int, event_type: str, data: dict):
        event = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        subscribers = self._subscribers.get(user_id, [])
        dead = []
        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(queue)
        for queue in dead:
            self.unsubscribe(user_id, queue)
