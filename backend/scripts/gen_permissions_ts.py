"""生成前端权限词表 frontend/src/config/permissions.gen.ts。

单一真相：从 backend/core/permissions.py 派生，杜绝前后端漂移。
运行：cd backend && uv run python scripts/gen_permissions_ts.py
或经 pnpm：pnpm run perm:generate（已并入 api:update）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# 确保 backend/ 在 sys.path（脚本方式运行时 scripts/ 才是 sys.path[0]）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.permissions import PERMISSIONS

OUT = Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "config" / "permissions.gen.ts"


def main_gen() -> None:
    keys = [p.key for p in PERMISSIONS]
    defs = [{"key": p.key, "label": p.label} for p in PERMISSIONS]

    keys_json = json.dumps(keys, ensure_ascii=False, indent=2)
    defs_json = json.dumps(defs, ensure_ascii=False, indent=2)

    ts = f"""// AUTO-GENERATED from backend/core/permissions.py — DO NOT EDIT.
// 由 `pnpm run perm:generate` 生成；修改权限请改后端并重新生成。

export const PERMISSION_KEYS = {keys_json} as const;

export type Permission = (typeof PERMISSION_KEYS)[number];

export interface PermissionDef {{
  key: Permission;
  label: string;
}}

export const PERMISSION_DEFS: PermissionDef[] = {defs_json};
"""

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(ts, encoding="utf-8")
    print(f"permissions.gen.ts written: {OUT}")


if __name__ == "__main__":
    main_gen()
