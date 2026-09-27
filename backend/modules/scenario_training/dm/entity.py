"""独立角色实体（**预留能力**）：把一个角色的台词交给它自己的 LLM 调用产出。

边界：DM 仍然决定"何时让谁说话、意图是什么"；实体**只输出台词**，
任何状态改动仍由 DM 声明的 `effects` 落地（见 docs/20 §五）。
包在角色上声明 `entity="dedicated"` 才会启用；默认 `inline` = DM 直接代言。
"""

from __future__ import annotations

import re

from infra.llm.client import CallContext, LLMClient
from infra.llm.profile import get_llm_config

from ..runtime.world import World
from ..schema import ScenarioPack
from .prompt import build_entity_messages

PURPOSE = "st_patient"
MAX_CHARS = 240
_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


def clean_line(raw: str) -> str:
    """把模型输出收拾成"一句台词"：去围栏、去引号、压空白、限长。"""
    text = _FENCE.sub("", raw.strip()).strip()
    text = text.strip().strip('"').strip("“”").strip("「」").strip()
    text = re.sub(r"\s+", " ", text)
    return text[:MAX_CHARS]


async def run_entity(
    llm: LLMClient,
    pack: ScenarioPack,
    world: World,
    actor_id: str,
    intent: str,
    *,
    user_id: int,
) -> str:
    messages = build_entity_messages(pack, world, actor_id, intent)
    ctx = CallContext(
        purpose=PURPOSE,
        user_id=user_id,
        log_meta={"module": "scenario_training", "pack": pack.key, "actor": actor_id},
    )
    raw = await llm.call(messages, purpose=PURPOSE, ctx=ctx, **get_llm_config(PURPOSE))
    return clean_line(raw)
