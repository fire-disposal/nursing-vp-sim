"""pack 加载与安装：**一份当前内容 + 整数版本**（没有修订系统）。

- **加载**：按 pack key 读 `st_packs.content` → 校验 → 按 `(key, version)` 缓存。
  内容改一次 version 就变，缓存自然失效；多 worker 各缓存各的，不依赖进程内文件时间戳。
- **安装**：同内容幂等（不涨版本），内容变了 `version + 1` —— 这正是"改就生效"的路径。
- **会话**：开局时把内容快照进会话行（`StSession.pack_content`），回放与判读读那份，
  因此**不需要**多行不可变修订来保证可复现性。

没有形状版本、没有转换、没有裁剪：内容在**写入时**校验，运行时读到的必然合法。
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError
from sqlalchemy import select

from models.scenario_training import StPack

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from .assets import seed_from_pack
from .schema import ScenarioPack
from .validation import validate_pack

PACKS_DIR = pathlib.Path(__file__).resolve().parent / "packs"
_CACHE: dict[tuple[str, int], ScenarioPack] = {}


class PackNotFound(RuntimeError):
    """指定的病例不存在。"""


class PackInvalid(RuntimeError):
    """病例内容未通过校验。"""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("；".join(problems))
        self.problems = problems


def reset_cache() -> None:
    """清空内容缓存（测试用；正常路径不需要——version 变了缓存键就变了）。"""
    _CACHE.clear()


def content_sha(content: dict[str, Any]) -> str:
    """内容身份（判断"这次保存有没有真的改东西"）。"""
    blob = json.dumps(content, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def get_pack(db: Session, pack_key: str) -> StPack | None:
    return db.execute(select(StPack).where(StPack.key == pack_key)).scalar_one_or_none()


def load_pack(db: Session, pack_key: str) -> tuple[StPack, ScenarioPack]:
    """读**当前**这一份内容并校验（按 `key + version` 缓存）。"""
    row = get_pack(db, pack_key)
    if row is None:
        raise PackNotFound(f"st_packs.key={pack_key}")
    cached = _CACHE.get((pack_key, row.version))
    if cached is not None:
        return row, cached
    pack = pack_from_content(row.content)
    _CACHE[(pack_key, row.version)] = pack
    return row, pack


def pack_from_content(content: dict[str, Any]) -> ScenarioPack:
    """内容 dict → 已校验的病例（会话快照、导入、安装都走这一条路）。"""
    pack = ScenarioPack.model_validate(content)
    problems = validate_pack(pack)
    if problems:
        raise PackInvalid(problems)
    return pack


# --------------------------------------------------------------------------- #
# 校验问题的**字段定位**（编辑器用）
#
# 校验本身只有一套（`ScenarioPack` + `validate_pack`，与安装/加载逐字相同）；这里只是把
# 它的两种输出翻译成"稳定路径 + 原因"：pydantic 已经带 `loc`，`validate_pack` 的中文串
# 以 `affordance <id>:` 这样的定位前缀开头——**不新增判据**，只做标签化。
# --------------------------------------------------------------------------- #

_PREFIXED_PARENTS = {
    "affordance": "affordances",
    "cue": "setting.cues",
    "fact": "facts",
    "criterion": "rubric",
    "asset": "assets",
    "device": "presentation.devices",
}
_PREFIXED_RE = re.compile(r"^(affordance|cue|fact|criterion|asset|device) ([^:]+?):")
_BOUNDS_RE = re.compile(r"^state_bounds ([^:]+?):")
_DUPLICATE_RE = re.compile(r"^(actor|affordance|cue|fact|criterion|asset|device) id 重复")
_DUPLICATE_PARENTS = {
    "actor": "actors",
    "affordance": "affordances",
    "cue": "setting.cues",
    "fact": "facts",
    "criterion": "rubric",
    "asset": "assets",
    "device": "presentation.devices",
}


def problem_path(message: str) -> str:
    """把一条校验问题映射到**稳定路径**（`affordances[suction].type`）；认不出就返回空串。"""
    match = _PREFIXED_RE.match(message)
    if match is not None:
        parent = _PREFIXED_PARENTS[match.group(1)]
        target = match.group(2)
        if "/" in target:  # device 的通道：`device <设备 id>/<状态键>`
            device, channel = target.split("/", 1)
            return f"{parent}[{device}].channels[{channel}]"
        return f"{parent}[{target}]"
    match = _BOUNDS_RE.match(message)
    if match is not None:
        return f"state_bounds[{match.group(1)}]"
    match = _DUPLICATE_RE.match(message)
    if match is not None:
        return _DUPLICATE_PARENTS[match.group(1)]
    for prefix, path in (("pack.title", "title"), ("pack.one_line", "one_line")):
        if message.startswith(prefix):
            return path
    if message.startswith("状态键") and "：" in message:
        return f"state_keys[{message.rsplit('：', 1)[1]}]"
    if message.startswith("failure"):
        return "failure_when"
    return ""


def validate_content(content: dict[str, Any]) -> list[dict[str, str]]:
    """走**加载期同一套校验**，返回 `[{"path", "message"}]`（空列表 = 可保存）。

    形状错误由 pydantic 报（带 `loc`），引用/词表/可达性错误由 `validate_pack` 报（带定位前缀）。
    """
    try:
        pack = ScenarioPack.model_validate(content)
    except ValidationError as exc:
        return [
            {"path": ".".join(str(part) for part in item["loc"]) or "(root)", "message": str(item["msg"])}
            for item in exc.errors()
        ]
    return [{"path": problem_path(message), "message": message} for message in validate_pack(pack)]


def content_meta(content: dict[str, Any]) -> dict[str, str]:
    """内容里的**展示字段**：标题 / 一句话 / 你将扮演谁 / 在哪儿（`st_packs` 不再各存一份）。

    只取四个展示字段、不整包校验：列表是入口页的读取路径，不该因为某份内容不完整而整页 500；
    缺字段给空串，由界面决定不显示。
    """
    player = content.get("player")
    setting = content.get("setting")
    return {
        "title": str(content.get("title") or ""),
        "one_line": str(content.get("one_line") or ""),
        "player_role": str(player.get("role") or "") if isinstance(player, dict) else "",
        "place": str(setting.get("place") or "") if isinstance(setting, dict) else "",
    }


def list_packs(db: Session, *, published_only: bool = False) -> list[dict[str, Any]]:
    """病例清单（学生入口用 `published_only=True`）。"""
    query = select(StPack).order_by(StPack.key)
    if published_only:
        query = query.where(StPack.published.is_(True))
    return [
        {
            "key": pack.key,
            "version": pack.version,
            "published": pack.published,
            "published_at": pack.published_at.isoformat() if pack.published_at else None,
            **content_meta(pack.content or {}),
        }
        for pack in db.execute(query).scalars().all()
    ]


def install(
    db: Session, pack: ScenarioPack, *, created_by: int | None = None, published: bool = True
) -> tuple[StPack, bool]:
    """写入**当前内容**。返回 `(pack, changed)`。

    - 同内容幂等：`changed=False`，`version` 不动（避免"存了但没变"刷版本号）。
    - 内容变了：`version + 1`（旧会话不受影响——它们带自己的快照）。
    - `published` 只在**新建行**时生效（运行期事实，不随内容覆盖）：
      播种/CLI/上传一份 JSON 默认上架；系统侧「新建空白 / 复制」显式传 `published=False`。
    """
    problems = validate_pack(pack)
    if problems:
        raise PackInvalid(problems)

    content = pack.model_dump(mode="json")
    sha = content_sha(content)
    row = get_pack(db, pack.key)
    if row is None:
        row = StPack(
            key=pack.key,
            content=content,
            version=1,
            published=published,
            published_at=datetime.now(UTC) if published else None,
        )
        db.add(row)
        db.flush()
        seed_from_pack(db, pack)
        return row, True

    # 展示字段（title / one_line）就在 `content` 里，随内容一起覆盖；
    # `published` / `published_at` 是运行期事实，不覆盖
    seed_from_pack(db, pack)
    if content_sha(row.content or {}) == sha:
        return row, False
    row.content = content
    row.version += 1
    db.flush()
    del created_by  # 保存人不再记录（没有修订历史；需要审计时看审计日志）
    return row, True


def load_pack_file(name: str) -> ScenarioPack:
    """按文件名或 pack key 读包（`sputum-ineffective` 与 `sputum_ineffective` 都能命中）。"""
    stem = name.removesuffix(".json")
    candidates = [PACKS_DIR / f"{stem}.json", PACKS_DIR / f"{stem.replace('-', '_')}.json"]
    path = next((item for item in candidates if item.is_file()), None)
    if path is None:
        raise PackNotFound(f"找不到包文件：{name}（尝试过 {[item.name for item in candidates]}）")
    return ScenarioPack.model_validate(json.loads(path.read_text(encoding="utf-8")))


def count_pack_files() -> int:
    return len(list(PACKS_DIR.glob("*.json")))
