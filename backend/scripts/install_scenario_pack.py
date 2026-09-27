"""把情境包装进 `st_pack_revisions`（幂等：同一内容复用同一修订）。

用法：
    cd backend && uv run python -m scripts.install_scenario_pack            # 装 packs/ 下全部
    cd backend && uv run python -m scripts.install_scenario_pack sputum-ineffective
"""

from __future__ import annotations

import sys

from core.database import SessionLocal
from core.unit_of_work import unit_of_work
from modules.scenario_training.pack_loader import PACKS_DIR, install, load_pack_file


def main(argv: list[str]) -> int:
    names = argv[1:]
    if not names:
        names = sorted(path.stem for path in PACKS_DIR.glob("*.json"))
    if not names:
        print(f"没有找到任何包：{PACKS_DIR}")
        return 1

    db = SessionLocal()
    try:
        for name in names:
            pack = load_pack_file(name)
            with unit_of_work(db, conflict_detail=f"安装情境包失败：{name}"):
                _, revision, created = install(db, pack, note="cli install")
                print(
                    f"{pack.key}: revision #{revision.revision_no} (id={revision.id}) "
                    f"{'created' if created else 'unchanged'} sha={revision.content_sha}"
                )
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
