#!/usr/bin/env python3
"""一次性病例迁移：``tools.*`` / ``exam_anchors`` → ``activities.<id>.config``（docs/15 §九）。

用法：
  cd backend && uv run python scripts/migrate_case_activities.py --check   # 只报告（默认）
  cd backend && uv run python scripts/migrate_case_activities.py --write   # 落盘改写 data/cases/*.json

映射（docs/15 §九）：
  ``tools.physical_exam``   → ``activities.physical_exam.config``
  ``tools.nursing_record``  → ``activities.nursing_record.config``
  ``tools.quiz``            → ``activities.quiz.config``
  ``exam_anchors``（顶层旧形状）→ ``activities.physical_exam.config``
    （与 ``tools.physical_exam`` 同形状：仅一方存在时逐字段无损；两方都存在时按 key 合并，
     ``tools.physical_exam`` 优先，并在报告里列出被覆盖的键）

范围：只改仓库里的病例文件（``backend/data/cases/*.json``）。**库里已有内容不在本脚本范围**：
  - ``cases.case_data`` 由 ``seed._seed_cases`` 在启动时把「未被教师改动」的行收敛到仓库版本；
  - 带 ``_seed_hash`` 且被教师改过的行、以及进行中训练固化的 ``record.case_snapshot`` 仍是旧形状，
    需要按同一映射修复（``convert_case_data`` 是纯函数，可被一次性数据迁移复用）。

硬约束：
  - **不因为 handler 存在就把 Activity 加进病例**：``nursing_diagnosis`` 迁移后仍为 0 例；
  - 只认 KNOWN 映射：``tools`` 里出现未知键 → 报错并拒绝改写（宁可停手，不静默丢配置）；
  - ``--check`` 同时校验：转换无损（config 与原 payload 逐字段相等）、schema 校验通过、
    病例审计（modules.cases.validator）0 error。
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from pydantic import ValidationError as PydanticValidationError

from modules.cases.validator import validate_case
from modules.training.activities import (
    ACTIVITY_CONFIG_KEY,
    ACTIVITY_IDS,
    CASE_ACTIVITIES_FIELD,
    resolve_activity_flags,
)
from schemas.case_schema import validate_case_data

CASES_DIR = BACKEND_DIR / "data" / "cases"

#: ``tools.<key>`` → Activity id（键名一致，显式列出以免"看名字猜"）
LEGACY_TOOL_FIELDS: dict[str, str] = {
    "physical_exam": "physical_exam",
    "nursing_record": "nursing_record",
    "quiz": "quiz",
}
#: 顶层旧形状（CaseDataSchema 曾声明 exam_anchors/nursing_record/quiz 于顶层）
LEGACY_TOP_LEVEL_FIELDS: dict[str, str] = {
    "exam_anchors": "physical_exam",
    "nursing_record": "nursing_record",
    "quiz": "quiz",
}
#: 明确禁止迁移进来的 Activity（无病例声明 → 迁移后必须仍为 0）
FORBIDDEN_ACTIVITY_IDS = ("nursing_diagnosis",)


@dataclass
class Conversion:
    """单病例转换结果。"""

    case: dict
    changes: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def already_migrated(self) -> bool:
        return not self.changes and not self.errors


def _merge(conversion: Conversion, *, tools: object, top_level: object, activity_id: str, top_key: str) -> object:
    """顶层旧形状与 ``tools.<id>`` 合并（tools.* 是较新格式，同名键优先）。"""
    if not isinstance(top_level, dict) or not isinstance(tools, dict):
        conversion.errors.append(f"顶层 {top_key} 与 tools.{activity_id} 类型不一致，无法合并")
        return tools
    overlapped = sorted(set(tools) & set(top_level))
    note = f"顶层 {top_key} 合并进 {CASE_ACTIVITIES_FIELD}.{activity_id}.{ACTIVITY_CONFIG_KEY}"
    if overlapped:
        note += f"（tools.{activity_id} 覆盖同名键: {', '.join(overlapped)}）"
    conversion.changes.append(note)
    return {**top_level, **tools}


def _collect_configs(case: dict, conversion: Conversion) -> dict[str, object]:
    """把 legacy 字段收集成 ``activity_id → config``。"""
    configs: dict[str, object] = {}

    tools = case.get("tools")
    if tools is not None:
        if not isinstance(tools, dict):
            conversion.errors.append(f"tools 必须是对象，当前为 {type(tools).__name__}")
            return configs
        for key, payload in tools.items():
            if key in FORBIDDEN_ACTIVITY_IDS:
                conversion.errors.append(f"tools.{key} 不得迁移（该 Activity 无正式产物，保持 0 例）")
                continue
            activity_id = LEGACY_TOOL_FIELDS.get(key)
            if activity_id is None:
                conversion.errors.append(f"tools.{key} 无迁移映射（未知工具配置，不能静默丢弃）")
                continue
            configs[activity_id] = payload
            conversion.changes.append(f"tools.{key} → {CASE_ACTIVITIES_FIELD}.{activity_id}.{ACTIVITY_CONFIG_KEY}")

    for key, activity_id in LEGACY_TOP_LEVEL_FIELDS.items():
        if key not in case:
            continue
        payload = case[key]
        if activity_id in configs:
            configs[activity_id] = _merge(
                conversion, tools=configs[activity_id], top_level=payload, activity_id=activity_id, top_key=key
            )
        else:
            configs[activity_id] = payload
            conversion.changes.append(f"顶层 {key} → {CASE_ACTIVITIES_FIELD}.{activity_id}.{ACTIVITY_CONFIG_KEY}")

    return configs


def _rewrite(case: dict, configs: dict[str, object]) -> dict:
    """字段顺序：``activities`` 落在第一个被移除的 legacy 键的位置，其余 legacy 键删除。"""
    declared = {activity_id: {ACTIVITY_CONFIG_KEY: payload} for activity_id, payload in configs.items()}
    legacy_keys = set(LEGACY_TOP_LEVEL_FIELDS)
    rewritten: dict = {}
    inserted = False
    for key, value in case.items():
        if key == "tools" or key in legacy_keys:
            if not inserted:
                rewritten[CASE_ACTIVITIES_FIELD] = declared
                inserted = True
            continue
        rewritten[key] = value
    if not inserted:
        rewritten[CASE_ACTIVITIES_FIELD] = declared
    return rewritten


def convert_case_data(case: dict) -> Conversion:
    """把旧形状病例转成 ``activities`` 声明（纯函数，不改入参）。"""
    conversion = Conversion(case=copy.deepcopy(case))
    if CASE_ACTIVITIES_FIELD in conversion.case:
        return conversion  # 幂等：已迁移的文件原样返回

    configs = _collect_configs(conversion.case, conversion)
    if conversion.errors:
        # 有无法映射的 legacy 键：宁可停手（原样返回），绝不静默丢配置
        conversion.changes.clear()
        conversion.case = copy.deepcopy(case)
        return conversion

    if configs:
        conversion.case = _rewrite(conversion.case, configs)
    return conversion


def _lossless(new_case: dict, old_case: dict) -> list[str]:
    """转换无损性：新声明里的 config 必须与原 payload 逐字段相等。"""
    problems: list[str] = []
    raw_tools = old_case.get("tools")
    tools: dict = raw_tools if isinstance(raw_tools, dict) else {}
    raw_declared = new_case.get(CASE_ACTIVITIES_FIELD)
    declared: dict = raw_declared if isinstance(raw_declared, dict) else {}
    for activity_id, declaration in declared.items():
        config = declaration.get(ACTIVITY_CONFIG_KEY) if isinstance(declaration, dict) else None
        if activity_id == "physical_exam":
            sources = []
            if "physical_exam" in tools:
                sources.append(tools["physical_exam"])
            if "exam_anchors" in old_case:
                sources.append(old_case["exam_anchors"])
            expected = sources[0] if len(sources) == 1 else ({**sources[1], **sources[0]} if sources else None)
            if expected is not None and config != expected:
                problems.append(f"{activity_id}: config 与源 payload 不一致")
            continue
        expected = tools.get(activity_id, old_case.get(activity_id))
        if expected is not None and config != expected:
            problems.append(f"{activity_id}: config 与源 payload 不一致")
    return problems


def _validate(conversion: Conversion, original: dict) -> list[str]:
    """无损性 + schema + 病例审计（迁移不得产出非法病例）。"""
    problems = _lossless(conversion.case, original)
    try:
        validate_case_data(conversion.case, strict=True)
    except PydanticValidationError as exc:
        problems.append(f"schema: {exc}")
    problems.extend(
        f"{issue.severity}: {issue.field}: {issue.message}" for issue in validate_case(conversion.case).errors
    )
    return problems


def _report(path: Path, *, write: bool) -> tuple[str, int]:
    """处理单个文件，返回 (状态, 错误数)。"""
    original = json.loads(path.read_text(encoding="utf-8"))
    conversion = convert_case_data(original)
    problems = list(conversion.errors) + (_validate(conversion, original) if conversion.changes else [])

    if problems:
        print(f"[FAIL] {path.name}")
        for problem in problems:
            print(f"       {problem}")
        return "failed", 1

    if conversion.already_migrated:
        print(f"[OK  ] {path.name} — 已迁移（无 legacy 字段）")
        return "migrated", 0

    print(f"[OK  ] {path.name} — 可无损转换")
    for change in conversion.changes:
        print(f"       {change}")
    if write:
        path.write_text(json.dumps(conversion.case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        assert json.loads(path.read_text(encoding="utf-8")) == conversion.case, f"{path.name} 落盘内容不一致"
        print(f"       → 已写入 {path.name}")
    return "convertible", 0


def _enablement_counts(paths: list[Path]) -> dict[str, int]:
    """各 Activity 的病例声明口径启用数（迁移后必须 physical_exam/nursing_record 全量、diagnosis 0）。"""
    counts = dict.fromkeys(ACTIVITY_IDS, 0)
    for path in paths:
        case = json.loads(path.read_text(encoding="utf-8"))
        for activity_id, enabled in resolve_activity_flags(case).items():
            if enabled:
                counts[activity_id] += 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description="病例 activities 迁移")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", default=True, help="只检查（默认）")
    mode.add_argument("--write", action="store_true", help="改写 data/cases/*.json")
    args = parser.parse_args()

    paths = sorted(CASES_DIR.glob("*.json"))
    outcomes = [_report(path, write=args.write) for path in paths]
    failed = sum(errors for _status, errors in outcomes)
    convertible = sum(1 for status, _ in outcomes if status == "convertible")
    migrated = sum(1 for status, _ in outcomes if status == "migrated")

    total = len(paths)
    print(f"\n汇总：{total} 个病例，{convertible} 可无损转换，{migrated} 已迁移，{failed} 失败")
    if total and not failed:
        print(f"{total}/{total} " + ("可无损转换" if convertible else "已迁移"))

    counts = _enablement_counts(paths)
    print("启用数：" + "，".join(f"{activity_id}={count}" for activity_id, count in counts.items()))
    if counts["nursing_diagnosis"]:
        print("ERROR: nursing_diagnosis 不得因 handler 存在而进入病例")
        failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
