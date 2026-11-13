"""患者回复的安全红线边界；规则库由外部实现，不在训练代码中维护违禁词。

本模块只固定调用契约。规则库可以来自独立配置、专用分类器或人工审核策略；
训练系统不认识具体词表，也不根据症状名称自行推断危险性。

边界：只检查**准备下发给学生并落库的患者候选回复**。学生输入不经过这里 ——
学生说了什么由临床评分与教师复核处理，不是患者台词的红线问题。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class SafetyViolation:
    """外部规则库返回的稳定分类；不携带或复制被检查的原文。"""

    code: str


class PatientSafetyRules(Protocol):
    """外置红线规则库：输入候选患者回复，返回最高置信的红线分类或 None。"""

    def find_violation(self, reply: str) -> SafetyViolation | None:
        """只判断准备发布的回复；学生输入与临床风险评估不属于这个接口。"""
        ...


def inspect_patient_reply(reply: str, *, rules: PatientSafetyRules) -> SafetyViolation | None:
    """V1/V2 输出边界共用的检查入口；命中后的失败策略由调用方决定。"""
    return rules.find_violation(reply)


SAFETY_BLOCKED_CODE = "chat.safety_blocked"
SAFETY_BLOCKED_MESSAGE = "这次患者回复未通过安全检查，未加入对话。你的发言已保留，可修改后重新发送。"


def inspect_configured_patient_reply(reply: str, app_state: object) -> SafetyViolation | None:
    """仅在应用显式配置了外置规则库时检查；未配置不等于内置一套词表。

    返回 None 的两种情况必须由调用方同等对待：没有配置规则库，或配置了但未命中。
    规则库自身的异常**不**在这里吞掉 —— 静默放行等于悄悄取消红线。
    """
    rules = getattr(app_state, "patient_safety_rules", None)
    if rules is None:
        return None
    return inspect_patient_reply(reply, rules=rules)
