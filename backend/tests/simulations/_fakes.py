"""共享的 in-memory ``Session`` 替身（临床推理模块的单测 harness）。

原宿主是 ``test_api_flow.py``；该文件的 HTTP 面已随运行期暴露一起下线
（docs/18 冻结 + 2026-09-28 收口，见 ``test_runtime_offline.py``），但服务层单测仍在用这个替身，
所以把它搬到这里独立存在。

它只实现 ``SimulationService`` 真正用到的会话表面：``add`` 分配 id、
``flush`` / ``commit`` / ``rollback`` 空实现、``get`` 按主键取行。
"""

from __future__ import annotations

from typing import Any


class FakeSession:
    def __init__(self) -> None:
        self.rows: dict[Any, Any] = {}
        self._next = 1

    def add(self, obj: Any) -> None:
        if getattr(obj, "id", None) is None:
            obj.id = self._next
            self._next += 1
        self.rows[obj.id] = obj

    def flush(self) -> None:
        pass

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def get(self, _model: Any, pk: Any) -> Any:
        return self.rows.get(pk)
