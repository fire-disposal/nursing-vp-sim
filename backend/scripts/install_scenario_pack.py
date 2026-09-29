"""把情境包写进 `st_packs`（**一份当前内容 + 整数版本**；幂等：同一内容不涨版本）。

用法：
    cd backend && uv run python -m scripts.install_scenario_pack            # 装 packs/ 下全部
    cd backend && uv run python -m scripts.install_scenario_pack sputum-ineffective
    cd backend && uv run python -m scripts.install_scenario_pack --check    # **只读**：比对库内
                                                                           # 当前内容与仓库文件，
                                                                           # 报「一致/需重装」

为什么需要 `--check`：包内容存在**库里**（`st_packs.content`），不在镜像里；发版只换二进制、
不会更新它。比"文件 vs 文件"看不出库里装的是哪一版，所以发布后核对必须用这里的 `--check`
（一致时退出码 0，有需重装的包时退出码 1）。比对口径与 `install()` 的幂等判断**同一把尺子**：
`pack_loader.content_sha(pack.model_dump(mode="json"))` vs `pack_loader.content_sha(row.content)`。
"""

from __future__ import annotations

import sys

from core.database import SessionLocal
from core.unit_of_work import unit_of_work
from modules.scenario_training.pack_loader import PACKS_DIR, content_sha, get_pack, install, load_pack_file


def main(argv: list[str]) -> int:
    args = argv[1:]
    check_only = "--check" in args
    names = [item for item in args if not item.startswith("-")]
    if not names:
        names = sorted(path.stem for path in PACKS_DIR.glob("*.json"))
    if not names:
        print(f"没有找到任何包：{PACKS_DIR}")
        return 1

    stale = False
    db = SessionLocal()
    try:
        for name in names:
            pack = load_pack_file(name)
            repo_sha = content_sha(pack.model_dump(mode="json"))
            row = get_pack(db, pack.key)
            if check_only:
                if row is None:
                    print(f"{pack.key}: 库里没有这个病例 → **需重装** (仓库 sha={repo_sha[:12]})")
                    stale = True
                    continue
                same = content_sha(row.content or {}) == repo_sha
                stale = stale or not same
                print(
                    f"{pack.key}: 库内 v{row.version} sha={content_sha(row.content or {})[:12]}"
                    f" | 仓库 sha={repo_sha[:12]} → {'一致' if same else '**需重装**'}"
                )
                continue
            with unit_of_work(db, conflict_detail=f"安装情境包失败：{name}"):
                saved, changed = install(db, pack)
                print(
                    f"{pack.key}: v{saved.version} "
                    f"{'created' if changed else 'unchanged'} sha={content_sha(saved.content or {})}"
                )
    finally:
        db.close()

    if check_only:
        print("（--check 只读：未写库；有「需重装」的包时退出码为 1）")
        return 1 if stale else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
