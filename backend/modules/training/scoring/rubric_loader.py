"""评分标准（Rubric）服务 —— 从 JSON 文件加载、验证，支持 mtime 热更"""

import json
import os
from pathlib import Path

_CACHE: dict[str, tuple[dict, float]] = {}
_RUBRIC_JSON_PATH = Path(__file__).parent / "rubric.json"


def load_rubric(version: str = "nursing_history_v1") -> dict:
    """从 JSON 文件加载评分标准，mtime 缓存支持热更"""
    filepath = _RUBRIC_JSON_PATH
    if not filepath.exists():
        raise FileNotFoundError(f"评分标准文件未找到: {filepath}")
    mtime = os.path.getmtime(filepath)
    cached = _CACHE.get(version)
    if cached is not None and cached[1] == mtime:
        return cached[0]
    with open(filepath, encoding="utf-8") as f:
        data = json.load(f)
    _CACHE[version] = (data, mtime)
    return data


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
