"""评分标准（Rubric）服务 —— 从 DB / JSON 文件加载、验证"""

import json
from pathlib import Path

from core.database import SessionLocal
from models import Rubric

_RUBRIC_DIR = Path(__file__).resolve().parent.parent / "data" / "rubrics"
_CACHE: dict[str, dict] = {}


def load_rubric(version: str = "nursing_history_v1") -> dict:
    """从 data/rubrics/ 加载评分标准 JSON 文件，结果缓存"""
    if version in _CACHE:
        return _CACHE[version]
    path = _RUBRIC_DIR / f"{version}.json"
    if not path.exists():
        raise FileNotFoundError(f"评分标准文件不存在: {path}")
    with open(path, encoding="utf-8") as f:
        rubric = json.load(f)
    _CACHE[version] = rubric
    return rubric


def load_active_rubric() -> Rubric | None:
    """从数据库加载当前激活的评分标准。若无激活版本则返回 None。"""
    db = SessionLocal()
    try:
        return db.query(Rubric).filter(Rubric.is_active).first()
    finally:
        db.close()


def load_rubric_dict() -> dict:
    """从 DB 加载激活评分标准，DB 无激活版本则回退到 data/rubrics/ JSON 文件。"""
    active = load_active_rubric()
    if active:
        return {
            "id": active.name,
            "name": active.name,
            "version": active.version,
            "total_max": active.total_max,
            "raw_max": active.raw_max,
            "raw_scale": active.raw_scale,
            "dimensions": active.dimensions,
        }
    return load_rubric("nursing_history_v1")


def get_rubric_version_id(rubric_dict: dict) -> str:
    """生成格式化的版本标识"""
    return f"{rubric_dict.get('id', 'unknown')}@{rubric_dict.get('version', '0')}"


def validate_dimensions(dimensions: list[dict]) -> list[str]:
    """验证 dimensions JSONB 结构合法性。返回错误列表，空列表=通过。"""
    errors = []
    if not isinstance(dimensions, list) or len(dimensions) == 0:
        errors.append("dimensions 必须是非空数组")
        return errors

    seen_ids = set()
    for i, dim in enumerate(dimensions):
        if not isinstance(dim, dict):
            errors.append(f"dimension[{i}] 必须是对象")
            continue
        if "name" not in dim:
            errors.append(f"dimension[{i}] 缺少 name")
        if "max" not in dim:
            errors.append(f"dimension[{i}] 缺少 max")
        if "items" not in dim or not isinstance(dim.get("items"), list):
            errors.append(f"dimension[{i}] 缺少 items 数组")
            continue

        for j, item in enumerate(dim["items"]):
            if not isinstance(item, dict):
                errors.append(f"dimension[{i}].items[{j}] 必须是对象")
                continue
            item_id = item.get("id", "")
            if item_id in seen_ids:
                errors.append(f"条目 ID 重复: {item_id}")
            seen_ids.add(item_id)
            for field in ("id", "name", "anchors"):
                if field not in item:
                    errors.append(f"dimension[{i}].items[{j}].{field} 缺失")

    return errors
