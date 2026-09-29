"""把库里的病例导出成**病例文件夹**（离线编辑 / 备份 / 交接）。

用法：
    cd backend && uv run python -m scripts.scenario_pack_export                    # 全部 → cases/
    cd backend && uv run python -m scripts.scenario_pack_export sputum-ineffective
    cd backend && uv run python -m scripts.scenario_pack_export --out-dir /tmp/cases

导出与导入/安装共用同一套读写（`case_folder`）：`case.toml`（机制与 meta）+ `case.md`（散文）+
`img/`（字节原样，不重编码）。`st_packs.version / published / published_at` 与 `st_assets` 行 id
不属于内容、不导出；装回库里就是 `install_scenario_pack` 那一条路。
"""

from __future__ import annotations

import argparse
import pathlib
import sys

from sqlalchemy import select

from core.database import SessionLocal
from models.scenario_training import StPack
from modules.scenario_training import assets, case_folder
from modules.scenario_training.pack_loader import PackInvalid, load_pack


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="把库里的病例导出成病例文件夹")
    parser.add_argument("keys", nargs="*", help="病例 key（不给就导出全部）")
    parser.add_argument("--out-dir", default=str(case_folder.CASES_DIR), help="输出目录（默认仓库的 cases/）")
    args = parser.parse_args(argv[1:])
    out = pathlib.Path(args.out_dir)

    db = SessionLocal()
    try:
        query = select(StPack).order_by(StPack.key)
        rows = db.execute(query).scalars().all()
        if args.keys:
            wanted = set(args.keys)
            rows = [row for row in rows if row.key in wanted or row.key.replace("-", "_") in wanted]
        if not rows:
            print("库里没有要导出的病例")
            return 1
        for row in rows:
            try:
                _, pack = load_pack(db, row.key)
            except PackInvalid as exc:
                print(f"{row.key}: **库里的内容没通过校验**：{'；'.join(exc.problems)}")
                continue
            images = assets.asset_files(db, pack)
            case_folder.write_folder(out / pack.key, pack, images)
            print(f"{pack.key}: v{row.version} → {out / pack.key}（{len(images)} 张图）")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
