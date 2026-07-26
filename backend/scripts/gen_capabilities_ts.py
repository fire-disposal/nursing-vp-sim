"""生成前端能力表 frontend/src/engine/capabilities.gen.ts。

单一真相：从 backend/contexts/training/capabilities.py 的 TOOL_BINDINGS 派生。
运行：cd backend && uv run python scripts/gen_capabilities_ts.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: F401 — trigger profile + tool registration
from contexts.training.capabilities import all_bindings
from profiles.registry import get_known_types

OUT = Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "engine" / "capabilities.gen.ts"


def _binding_to_obj(b) -> dict:
    return {
        "key": b.tool,
        "label": b.label,
        "description": b.description,
        "tier": "toggleable",
        "trainingTypes": list(get_known_types()),
        "requires": [],
    }


def main_gen() -> None:
    bindings = all_bindings()
    all_caps = {b.tool: _binding_to_obj(b) for b in bindings}

    training_caps = {
        t: [b.tool for b in bindings] for t in get_known_types()
    }

    all_json = json.dumps(all_caps, ensure_ascii=False, indent=2)
    training_json = json.dumps(training_caps, ensure_ascii=False, indent=2)

    ts = f"""// AUTO-GENERATED from backend/contexts/training/capabilities.py — DO NOT EDIT.
// 由 `pnpm run cap:generate` 生成；修改能力请改后端并重新生成。

export type CapabilityTier = "builtin" | "toggleable";

export interface CapabilityDef {{
  key: string;
  label: string;
  description: string;
  tier: CapabilityTier;
  trainingTypes: string[] | null;
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
