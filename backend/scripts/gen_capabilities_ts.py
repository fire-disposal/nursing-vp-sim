"""生成前端能力表 frontend/src/engine/capabilities.gen.ts。

单一真相：从 backend/core/capabilities.py 派生，杜绝前后端漂移。
运行：cd backend && uv run python scripts/gen_capabilities_ts.py
或经 pnpm：pnpm run cap:generate（已并入 api:update）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# 确保 backend/ 在 sys.path（脚本方式运行时 scripts/ 才是 sys.path[0]）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 导入 main 以触发 profile 注册（与 api:spec 相同做法）
import main  # noqa: F401
from contexts.training.capabilities import ALL_CAPABILITIES, capabilities_for_type
from profiles.registry import get_known_types

OUT = Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "engine" / "capabilities.gen.ts"


def _cap_to_obj(c) -> dict:
    return {
        "key": c.key,
        "label": c.label,
        "description": c.description,
        "tier": c.tier,
        "trainingTypes": list(c.training_types) if c.training_types is not None else None,
        "defaultOn": c.default,
        "requires": list(c.requires),
    }


def main_gen() -> None:
    all_caps = {k: _cap_to_obj(c) for k, c in ALL_CAPABILITIES.items()}
    # 每训练类型可配置（toggleable）能力键——builtin 隐式恒开，不出现在配置 UI
    training_caps = {
        t: [k for k, c in capabilities_for_type(t).items() if c.tier == "toggleable"] for t in get_known_types()
    }

    all_json = json.dumps(all_caps, ensure_ascii=False, indent=2)
    training_json = json.dumps(training_caps, ensure_ascii=False, indent=2)

    ts = f"""// AUTO-GENERATED from backend/core/capabilities.py — DO NOT EDIT.
// 由 `pnpm run cap:generate` 生成；修改能力请改后端并重新生成。

export type CapabilityTier = "builtin" | "toggleable";

export interface CapabilityDef {{
  key: string;
  label: string;
  description: string;
  tier: CapabilityTier;
  trainingTypes: string[] | null;
  defaultOn: boolean;
  requires: string[];
}}

export const ALL_CAPABILITIES: Record<string, CapabilityDef> = {all_json};

/** 每训练类型可配置（toggleable）能力键；builtin 隐式恒开，不在此列。 */
export const TRAINING_CAPABILITIES: Record<string, string[]> = {training_json};
"""

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(ts, encoding="utf-8")
    print(f"capabilities.gen.ts written: {OUT}")


if __name__ == "__main__":
    main_gen()
