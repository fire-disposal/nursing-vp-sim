"""情境训练的隔离与中立性断言。

四条规则（docs/20 §二 2.3）：
1. 本模块只允许 import 标准库/三方库/`infra/**`/自身，外加共享账号入口 `modules.auth`；
2. 反向禁止：老模块不得 import 本模块；
3. **工具层领域中立**：平台代码（除 `packs/` 内容外）不得出现领域（医疗）语义；
4. `packs/` 只放数据，且必须能被 `ScenarioPack` 校验通过。
"""

from __future__ import annotations

import ast
import json
import pathlib

import pytest

from modules.scenario_training.schema import ScenarioPack

BACKEND = pathlib.Path(__file__).resolve().parents[2]
MODULE_ROOT = BACKEND / "modules" / "scenario_training"
PACKS_DIR = MODULE_ROOT / "packs"

ALLOWED_MODULE_PREFIXES = ("modules.scenario_training", "modules.auth")

# 强领域词：平台代码里出现即视为耦合（pack 内容不受限）
DOMAIN_TERMS = (
    "spo2",
    "血压",
    "心率",
    "呼吸音",
    "痰",
    "护理",
    "医嘱",
    "诊断",
    "给药",
    "体征",
    "临床",
    "脾破裂",
    "内出血",
    "高血压",
)


def _py_files(root: pathlib.Path) -> list[pathlib.Path]:
    return sorted(p for p in root.rglob("*.py") if "__pycache__" not in p.parts)


def _imported_modules(path: pathlib.Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.append(node.module)
    return names


def test_module_imports_only_allowed():
    violations = [
        f"{path.relative_to(BACKEND)} -> {name}"
        for path in _py_files(MODULE_ROOT)
        for name in _imported_modules(path)
        if name.split(".")[0] == "modules" and not name.startswith(ALLOWED_MODULE_PREFIXES)
    ]
    assert not violations, f"情境训练不得依赖其他 modules：{violations}"


def test_no_reverse_import():
    violations = [
        f"{path.relative_to(BACKEND)} -> {name}"
        for path in _py_files(BACKEND / "modules")
        if MODULE_ROOT not in path.parents
        for name in _imported_modules(path)
        if name.startswith("modules.scenario_training")
    ]
    assert not violations, f"老模块不得依赖情境训练：{violations}"


def test_platform_code_is_domain_neutral():
    # packs/ 是内容（允许领域语义）；其余是本轨的平台代码，必须中立
    hits = [
        f"{path.relative_to(MODULE_ROOT)}:{term}"
        for path in _py_files(MODULE_ROOT)
        if PACKS_DIR not in path.parents
        for term in DOMAIN_TERMS
        if term in path.read_text(encoding="utf-8").lower()
    ]
    assert not hits, f"平台代码出现领域语义（应移入 pack 内容）：{hits}"


def test_packs_are_valid_data():
    packs = sorted(PACKS_DIR.glob("*.json"))
    assert packs, "至少应有一个 pack"
    for path in packs:
        pack = ScenarioPack.model_validate(json.loads(path.read_text(encoding="utf-8")))
        assert pack.key, f"{path.name} 缺少 key"
        for affordance in pack.affordances:
            for effect in affordance.effects:
                namespaced = effect.key if "." in effect.key else f"{effect.target}.{effect.key}"
                assert namespaced in pack.state_keys, f"{path.name}: 未登记状态键 {namespaced}"
        for point in pack.rubric:
            for key in ("strong", "adequate", "missed"):
                assert key in point.anchors, f"{path.name}: {point.id} 缺锚点 {key}"


def test_every_pack_can_advance_time():
    """每个包至少有一个**开场就可用**的耗时动作（`time_cost > 0`）。

    没有这条途径时，时间单位永远停在 0：`turn_gte` / `turns_without_action` 类触发永不成真，
    按时间步结算的 dims（latency / slope）也没有可解释的值——2026-09-29 的 `bp-contradiction`
    六个动作全 0 就是这种状态（补了「让他安静休息 5 分钟后再测」=5 才成立）。
    门控动作不算数：`visible_when` 未成立时它自己就不可用，不能当唯一的时间来源。
    """
    packs = sorted(PACKS_DIR.glob("*.json"))
    assert packs, "至少应有一个 pack"
    for path in packs:
        pack = ScenarioPack.model_validate(json.loads(path.read_text(encoding="utf-8")))
        advancing = [a.id for a in pack.affordances if a.time_cost > 0 and a.visible_when is None]
        assert advancing, f"{path.name}: 没有任何开场可用的耗时动作，时间永远不会前进"


@pytest.mark.parametrize("term", DOMAIN_TERMS)
def test_domain_term_is_normalized(term: str) -> None:
    """守卫自检：词表条目本身规范（防止空串/带空格导致假绿）。"""
    assert term
    assert term.strip() == term
