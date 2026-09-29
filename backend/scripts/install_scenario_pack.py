"""把情境包装进 `st_pack_revisions`（幂等：同一内容复用同一修订）。

用法：
    cd backend && uv run python -m scripts.install_scenario_pack            # 装 packs/ 下全部
    cd backend && uv run python -m scripts.install_scenario_pack sputum-ineffective
    cd backend && uv run python -m scripts.install_scenario_pack --check    # **只读**：比对库内最新修订
                                                                           # 与仓库文件，报「一致/需重装」

为什么需要 `--check`：包内容存在**库里**（`st_pack_revisions` 不可变），不在镜像里；发版只换
二进制、不会更新它。`scenario_pack_migrate --dry-run` 比的是"文件 vs 转换后的文件"，**看不到库里
装的是哪一版**，所以发布后核对必须用这里的 `--check`（一致时退出码 0，有需重装的包时退出码 1）。
"""

from __future__ import annotations

import sys

from core.database import SessionLocal
from core.unit_of_work import unit_of_work
from modules.scenario_training.pack_loader import PACKS_DIR, install, latest_revision, load_pack_file


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
            if check_only:
                latest = latest_revision(db, pack.key)
                repo_sha = pack.content_sha()
                if latest is None:
                    print(f"{pack.key}: 库里没有修订 → **需重装** (仓库 sha={repo_sha[:12]})")
                    stale = True
                    continue
                _row, revision = latest
                same = revision.content_sha == repo_sha
                stale = stale or not same
                print(
                    f"{pack.key}: 库内 rev#{revision.id} (no={revision.revision_no}) sha={str(revision.content_sha)[:12]}"
                    f" | 仓库 sha={repo_sha[:12]} → {'一致' if same else '**需重装**'}"
                )
                continue
            with unit_of_work(db, conflict_detail=f"安装情境包失败：{name}"):
                _, revision, created = install(db, pack, note="cli install")
                print(
                    f"{pack.key}: revision #{revision.revision_no} (id={revision.id}) "
                    f"{'created' if created else 'unchanged'} sha={revision.content_sha}"
                )
    finally:
        db.close()

    if check_only:
        print("（--check 只读：未写库；有「需重装」的包时退出码为 1）")
        return 1 if stale else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
