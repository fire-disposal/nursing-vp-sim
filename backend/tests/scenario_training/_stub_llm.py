"""测试用桩 LLM：**按阶段**返回该阶段合法的 JSON（解析 → `IntentResolution`；演出 → `SceneDelivery`）。

新机制里演出阶段没有写权限，所以桩也不能"编世界"——需要世界变化就用 `intent` 指定声明动作。
"""

from __future__ import annotations

import json
from typing import Any


def stage_aware(
    messages: list[dict[str, str]], *, intent: dict[str, Any] | None = None, delivery: dict[str, Any] | None = None
) -> str:
    system = messages[0]["content"] if messages else ""
    if "意图解析器" in system:
        return json.dumps(
            intent
            or {
                "kind": "action",
                "affordance_id": None,
                "utterance": "",
                "clarification": "",
                "selection": [],
                "social_updates": [],
            },
            ensure_ascii=False,
        )
    return json.dumps(
        delivery
        or {
            "messages": [{"speaker": None, "text": "机器还在响。"}],
            "hints": [],
            "assets": [],
            "highlights": [],
        },
        ensure_ascii=False,
    )
