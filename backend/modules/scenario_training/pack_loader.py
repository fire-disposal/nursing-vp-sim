"""pack 加载与安装。

加载：按 **revision id** 读库 → 校验 → 按 revision 缓存（修订不可变，故缓存永远不会过期；
多 worker 各缓存各的，新修订是新 id，天然没有陈旧问题——不依赖进程内文件时间戳）。

安装：把一份 JSON 包写进 `st_packs` / `st_pack_revisions`。同一内容（sha 相同）幂等复用，
内容变化则追加新修订号——这正是"改 JSON 就改体验"的落地路径。
"""

from __future__ import annotations

import inspect
import json
import pathlib
from typing import TYPE_CHECKING, Any, Union, get_args, get_origin

from pydantic import BaseModel
from sqlalchemy import select

from models.scenario_training import StPack, StPackRevision

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from .assets import seed_from_pack
from .schema import PACK_SCHEMA_VERSION, ScenarioPack
from .validation import validate_pack

PACKS_DIR = pathlib.Path(__file__).resolve().parent / "packs"
_CACHE: dict[int, ScenarioPack] = {}


class PackNotFound(RuntimeError):
    """指定的 pack / 修订不存在。"""


class PackInvalid(RuntimeError):
    """pack 未通过加载期校验。"""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("；".join(problems))
        self.problems = problems


def reset_cache() -> None:
    """清空修订缓存（测试与"热载后强制重读"用；修订不可变，正常路径不需要）。"""
    _CACHE.clear()


def load_revision(db: Session, revision_id: int) -> ScenarioPack:
    cached = _CACHE.get(revision_id)
    if cached is not None:
        return cached
    row = db.execute(select(StPackRevision).where(StPackRevision.id == revision_id)).scalar_one_or_none()
    if row is None:
        raise PackNotFound(f"st_pack_revisions.id={revision_id}")
    pack = _validated(row.content)
    _CACHE[revision_id] = pack
    return pack


def _prune_to_model(data: Any, model: type[BaseModel]) -> Any:
    """按目标模型裁掉未知键（递归）——**历史修订带已删除字段时仍必须可读**。

    只有 `pack_schema_version < 当前版本` 的存量内容才走这条路；当前版本的包仍然严格校验，
    作者的拼写错误不会被静默吞掉。
    """
    if not isinstance(data, dict):
        return data
    fields = model.model_fields
    pruned: dict[str, Any] = {}
    for key, value in data.items():
        field = fields.get(key)
        if field is None:
            continue
        inner = _inner_model(field.annotation)
        if inner is None:
            pruned[key] = value
        elif isinstance(value, list):
            pruned[key] = [_prune_to_model(item, inner) for item in value]
        elif value is None:
            pruned[key] = None
        else:
            pruned[key] = _prune_to_model(value, inner)
    return pruned


def _inner_model(annotation: Any) -> type[BaseModel] | None:
    """从注解里取出嵌套模型（支持 `Model` / `list[Model]` / `Model | None`）。"""
    origin = get_origin(annotation)
    if origin is list:
        return _inner_model(get_args(annotation)[0])
    if origin is Union:
        for arg in get_args(annotation):
            found = _inner_model(arg)
            if found is not None:
                return found
        return None
    if inspect.isclass(annotation) and issubclass(annotation, BaseModel):
        return annotation
    return None


def _validated(content: dict[str, Any]) -> ScenarioPack:
    payload = content
    if int(content.get("pack_schema_version", 1)) < PACK_SCHEMA_VERSION:
        payload = _prune_to_model(content, ScenarioPack)
    pack = ScenarioPack.model_validate(payload)
    problems = validate_pack(pack)
    if problems:
        raise PackInvalid(problems)
    return pack


def latest_revision(db: Session, pack_key: str) -> tuple[StPack, StPackRevision] | None:
    pack = db.execute(select(StPack).where(StPack.key == pack_key)).scalar_one_or_none()
    if pack is None:
        return None
    revision = db.execute(
        select(StPackRevision)
        .where(StPackRevision.pack_id == pack.id)
        .order_by(StPackRevision.revision_no.desc())
        .limit(1)
    ).scalar_one_or_none()
    if revision is None:
        return None
    return pack, revision


def list_packs(db: Session) -> list[dict[str, Any]]:
    """供前端/开发选择：每个 pack 的最新修订摘要。"""
    packs = db.execute(select(StPack).order_by(StPack.key)).scalars().all()
    out: list[dict[str, Any]] = []
    for pack in packs:
        revision = db.execute(
            select(StPackRevision)
            .where(StPackRevision.pack_id == pack.id)
            .order_by(StPackRevision.revision_no.desc())
            .limit(1)
        ).scalar_one_or_none()
        out.append(
            {
                "key": pack.key,
                "title": pack.title,
                "state": pack.state,
                "one_line": pack.one_line,
                "revision_id": revision.id if revision else None,
                "revision_no": revision.revision_no if revision else None,
            }
        )
    return out


def install(db: Session, pack: ScenarioPack, *, note: str = "") -> tuple[StPack, StPackRevision, bool]:
    """写入或追加修订。返回 (pack, revision, created)。"""
    problems = validate_pack(pack)
    if problems:
        raise PackInvalid(problems)

    sha = pack.content_sha()
    row = db.execute(select(StPack).where(StPack.key == pack.key)).scalar_one_or_none()
    if row is None:
        row = StPack(key=pack.key, title=pack.title, state=pack.state.value, one_line=pack.one_line)
        db.add(row)
        db.flush()
    else:
        # `state` 是**管理端拥有的运行期事实**（experimental / reviewed），不是包内容字段：
        # 只在新建成行时用包里的值当初值，之后重传包/补传图片**不覆盖**它——
        # 否则管理员标成 reviewed 之后，下一次上传会被包 JSON 静默回退成 experimental。
        # 标题与一句话描述是展示字段，仍随包内容更新（作者改文案要能生效）。
        row.title = pack.title
        row.one_line = pack.one_line

    latest = db.execute(
        select(StPackRevision)
        .where(StPackRevision.pack_id == row.id)
        .order_by(StPackRevision.revision_no.desc())
        .limit(1)
    ).scalar_one_or_none()
    # 资源播种与修订是否变化无关（幂等：已有字节的跳过）——首次安装/补种都靠它
    seed_from_pack(db, pack)
    if latest is not None and latest.content_sha == sha:
        return row, latest, False

    next_no = (latest.revision_no + 1) if latest is not None else 1
    revision = StPackRevision(
        pack_id=row.id,
        revision_no=next_no,
        pack_schema_version=pack.pack_schema_version,
        content=pack.model_dump(mode="json"),
        content_sha=sha,
        note=note,
    )
    db.add(revision)
    db.flush()
    return row, revision, True


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
