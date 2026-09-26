"""评分标准（Rubric）—— 唯一来源：同目录 ``rubric.json``。

- ``load_rubric()``：读取基准 rubric，mtime 变化时自动重载（教师改文件即生效）。
- ``get_base_rubric()``：基准 rubric 的深拷贝，供需要持有/可能修改的调用方。

``rubric.json`` 是唯一的基准真相（`profile.HISTORY_TAKING.rubric` 也由它构造）；
评分实际口径 = ``rubric.build_final_rubric()``（按病例能力追加可选维度），
记录创建时固化进 ``record.rubric_snapshot``，评分只读快照。
"""

import json
import os
from copy import deepcopy
from pathlib import Path

_CACHE: dict[str, tuple[dict, float]] = {}
_RUBRIC_JSON_PATH = Path(__file__).parent / "rubric.json"


def load_rubric() -> dict:
    """从 JSON 文件加载基准 rubric；mtime 变化时重载。

    返回进程内缓存对象（身份稳定，热更测试依赖这一点），调用方不得就地修改——
    需要可写副本请用 ``get_base_rubric()``。
    """
    filepath = _RUBRIC_JSON_PATH
    if not filepath.exists():
        raise FileNotFoundError(f"评分标准文件未找到: {filepath}")
    mtime = os.path.getmtime(filepath)
    key = str(filepath)
    cached = _CACHE.get(key)
    if cached is not None and cached[1] == mtime:
        return cached[0]
    with open(filepath, encoding="utf-8") as f:
        data = json.load(f)
    _CACHE[key] = (data, mtime)
    return data


def get_base_rubric() -> dict:
    """基准 rubric 的深拷贝（不共享可变对象）。"""
    return deepcopy(load_rubric())


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
