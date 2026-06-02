"""评分标准（Rubric）服务 —— 从 DB 加载、验证维度格式"""

from database import SessionLocal
from models import Rubric


def load_active_rubric() -> Rubric | None:
    """从数据库加载当前激活的评分标准。若无激活版本则返回 None。"""
    db = SessionLocal()
    try:
        return db.query(Rubric).filter(Rubric.is_active == True).first()
    finally:
        db.close()


def load_rubric_dict() -> dict:
    """从 DB 加载激活评分标准，转换为 scoring.py 所需 dict 格式。
    若 DB 无激活版本，回退到 rubrics/nursing_history_v1.json 文件。
    """
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
    from rubrics import load_rubric
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
