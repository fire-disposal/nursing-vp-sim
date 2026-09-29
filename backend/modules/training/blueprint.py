"""教学蓝图的**运行时只读视图**。

蓝图是病例内容的一部分（``CaseDataSchema.blueprint``），随病例 revision 冻结、随训练
记录快照固化。本模块只做纯函数读取，不写数据、不新建第二份病例真相；校验与发布门禁在
``modules/cases/validator.py``。

消费方与边界：

| 消费方 | 取什么 | 不得取什么 |
|---|---|---|
| 评分（``scoring/engine.py``） | 任务边界、适用项声明、干预可观察性 | 无（学生证据之外无额外事实） |
| 引导提示（``router/session_views.py``） | 关键线索的**领域与意义** | 唯一问句、参考答案 |
| 患者上下文 | **不消费**蓝图（见 ``prompts/patient.py`` 的事实边界） | 全部 |
| 重练/变式入口（``modules/training/practice.py``） | 家族与变式关系 | — |

不适用项由**病例预先声明**（``blueprint.not_applicable_items``），不由评分模型自行缩小
分母 —— 因此本模块是适用性判定的唯一入口。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

FIELD_BLUEPRINT = "blueprint"


def blueprint_of(case_data: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
    """病例载荷里的蓝图映射；缺失或形状非法返回 ``None``（形状问题由门禁报出）。"""
    if not isinstance(case_data, Mapping):
        return None
    raw = case_data.get(FIELD_BLUEPRINT)
    return raw if isinstance(raw, Mapping) else None


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    return [str(item) for item in value if str(item).strip()]


def not_applicable_item_ids(case_data: Mapping[str, Any] | None) -> frozenset[str]:
    """本次任务**不适用**的 rubric 条目 id（病例声明）。

    缺失声明 = 空集合 = 全部条目适用；绝不因为模型没答上来而缩小分母。
    """
    blueprint = blueprint_of(case_data)
    if blueprint is None:
        return frozenset()
    return frozenset(_as_str_list(blueprint.get("not_applicable_items")))


def intervention_observable(case_data: Mapping[str, Any] | None) -> bool:
    """本次任务是否有「实施干预并观察效果」的机会。

    默认 ``False``：**未声明即无可观察机会**。没有机会时评价计划与评价方法，既不奖励
    编造结局，也不因无法观察而扣分。
    """
    blueprint = blueprint_of(case_data)
    if blueprint is None:
        return False
    return bool(blueprint.get("intervention_observable"))


def family_view(case_data: Mapping[str, Any] | None) -> dict[str, str]:
    """家族与变式关系视图（供重练/迁移入口解析允许的目标病例）。"""
    blueprint = blueprint_of(case_data)
    if blueprint is None:
        return {"family_id": "", "variant_role": "", "transfer_of": ""}
    role = blueprint.get("variant_role")
    return {
        "family_id": str(blueprint.get("family_id") or ""),
        "variant_role": str(role) if isinstance(role, str) else "",
        "transfer_of": str(blueprint.get("transfer_of") or ""),
    }


def guided_hints(case_data: Mapping[str, Any] | None) -> list[dict[str, str]]:
    """引导模式的领域提示：只给「还需弄清的领域 + 其意义」，不给唯一问句。

    蓝图缺失或无带意义的线索时返回空列表 —— 调用方据此决定回落到既有行为，不假装有提示。
    """
    blueprint = blueprint_of(case_data)
    if blueprint is None:
        return []
    clues = blueprint.get("clues")
    if not isinstance(clues, Sequence) or isinstance(clues, (str, bytes)):
        return []
    hints: list[dict[str, str]] = []
    for clue in clues:
        if not isinstance(clue, Mapping):
            continue
        significance = str(clue.get("significance") or "").strip()
        if not significance:
            continue
        hints.append(
            {
                "clue_id": str(clue.get("id") or ""),
                "domain": str(clue.get("label") or "").strip(),
                "significance": significance,
                "source": str(clue.get("source") or ""),
            }
        )
    return hints


def _bullet_section(title: str, values: Sequence[str]) -> list[str]:
    if not values:
        return []
    lines = [f"### {title}"]
    lines.extend(f"- {value}" for value in values)
    lines.append("")
    return lines


def scoring_task_boundary_text(case_data: Mapping[str, Any] | None) -> str:
    """评分提示词的「本次任务边界」段。

    蓝图缺失时返回空串：既有病例保持原有评分口径，不凭空声明适用性或缺失项。
    """
    blueprint = blueprint_of(case_data)
    if blueprint is None:
        return ""

    lines: list[str] = ["## 本次任务边界", ""]
    objectives = _as_str_list(blueprint.get("learning_objectives"))
    prerequisites = str(blueprint.get("prerequisites") or "").strip()
    lines.extend(_bullet_section("本次训练的学习目标", objectives))
    if prerequisites:
        lines.extend([f"前置能力：{prerequisites}", ""])

    lines.extend(_bullet_section("必须覆盖项", _as_str_list(blueprint.get("must_cover"))))
    lines.extend(_bullet_section("情境相关项（出现则评，不出现不算遗漏）", _as_str_list(blueprint.get("situational"))))
    lines.extend(_bullet_section("关键遗漏项（缺失必须单独指出）", _as_str_list(blueprint.get("key_omissions"))))
    lines.extend(_bullet_section("可接受的证据整合路径", _as_str_list(blueprint.get("acceptable_evidence"))))
    lines.extend(_bullet_section("典型错误", _as_str_list(blueprint.get("typical_errors"))))

    not_applicable = sorted(not_applicable_item_ids(case_data))
    if not_applicable:
        lines.append("### 本次任务不适用的条目（由病例声明，score 必须为 null，不计入分母）")
        lines.extend(f"- {item_id}" for item_id in not_applicable)
        lines.append("")

    if intervention_observable(case_data):
        lines.append("本次任务中学生有机会实施护理措施并观察效果：可按实际观察到的结果评价。")
    else:
        lines.append(
            "本次任务中学生**没有**实施干预并观察效果的机会：评价其护理计划与效果评价方法是否合理，"
            "不得要求或奖励编造措施效果，也不得因无法观察效果而扣分。"
        )
    lines.append("")
    return "\n".join(lines)
