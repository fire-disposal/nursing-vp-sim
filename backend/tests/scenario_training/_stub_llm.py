"""测试用桩 LLM：模拟 `LLMClient.call_with_tools` 的**一个循环**。

新机制里模型只能通过工具改世界，所以桩也必须走工具：`rounds` 是"每一轮模型给出哪些工具调用"，
最后一轮固定是 `deliver`（除非显式要求"不交付"来覆盖失败口径）。
"""

from __future__ import annotations

from typing import Any

DEFAULT_NARRATION = "监护仪还在响。"

#: 求提示（只读）路径允许出现的工具
READ_TOOLS = frozenset({"world_state", "actor_knows", "history_recent"})


class StubAgent:
    """按脚本逐轮调用工具，最后交付。记下每一轮收到的 messages（供断言上下文）。"""

    def __init__(
        self,
        rounds: list[list[tuple[str, dict[str, Any]]]] | None = None,
        *,
        narration: str = DEFAULT_NARRATION,
        deliver: bool = True,
    ) -> None:
        self.rounds: list[list[tuple[str, dict[str, Any]]]] = [list(batch) for batch in (rounds or [])]
        self.narration = narration
        self.deliver = deliver
        self.calls: list[list[dict[str, str]]] = []
        self.tools: list[dict[str, Any]] = []
        self.model_rounds = 0
        self.results: list[Any] = []

    async def call_with_tools(
        self,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]],
        tool_handlers: dict[str, Any],
        *,
        purpose: str = "",
        **_: Any,
    ) -> str:
        self.calls.append(messages)
        self.tools = tools
        for batch in self.rounds:
            self.model_rounds += 1
            for name, args in batch:
                self.results.append(tool_handlers[name](args))
        if self.deliver:
            self.model_rounds += 1
            self.results.append(tool_handlers["deliver"]({"narration": self.narration}))
        return ""

    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        raise AssertionError("单循环 runtime 不走 llm.call（只走 call_with_tools）")

    # ── 便捷构造 ──

    @property
    def tool_names(self) -> list[str]:
        """本轮实际提供给模型的工具名（用于断言"求提示只给读工具"）。"""
        return [item["function"]["name"] for item in self.tools]
