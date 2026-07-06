from dataclasses import dataclass, field
from typing import Literal

Tier = Literal["builtin", "toggleable"]


@dataclass(frozen=True)
class Capability:
    """一个训练期功能能力。

    tier:
      - "builtin"    内置、恒开、UI 不显示开关、教师不可关（如患者情绪）。
      - "toggleable" 可开关，有默认值，教师/配置可设。
    training_types: 适用的训练类型；None = 所有类型。
    requires: 声明式耦合——本能力开启时，其依赖能力被强制开启。
    default: 仅 toggleable 有意义。
    """

    key: str
    label: str
    description: str
    tier: Tier
    training_types: tuple[str, ...] | None = None
    default: bool = False
    requires: tuple[str, ...] = field(default_factory=tuple)


ALL_CAPABILITIES: dict[str, Capability] = {
    "emotion": Capability(
        key="emotion",
        label="患者情绪状态机",
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化。虚拟病人的内置第一性质，全类型恒开。",
        tier="builtin",
        training_types=None,
    ),
    "patient_initiative": Capability(
        key="patient_initiative",
        label="患者主动追问",
        description="患者根据性格/情绪/等待时长主动发言。",
        tier="toggleable",
        training_types=("history_taking",),
        default=False,
        requires=("emotion",),
    ),
    "physical_exam": Capability(
        key="physical_exam",
        label="护理查体",
        description="允许学生触发护理操作（测血压/体温/听诊等）。",
        tier="toggleable",
        training_types=("history_taking", "triage"),
        default=False,
    ),
    "exam_scene": Capability(
        key="exam_scene",
        label="人体查体场景",
        description="启用可视化人体查体交互（点击人体部位执行检查）。",
        tier="toggleable",
        training_types=("triage",),
        default=False,
    ),
    "questionnaire": Capability(
        key="questionnaire",
        label="问卷评估",
        description="训练结束后向学生推送问卷调查。",
        tier="toggleable",
        training_types=None,
        default=False,
    ),
}


def _applies(cap: Capability, training_type: str | None) -> bool:
    if training_type is None or cap.training_types is None:
        return True
    return training_type in cap.training_types


def all_capabilities() -> dict[str, Capability]:
    return dict(ALL_CAPABILITIES)


def capabilities_for_type(training_type: str) -> dict[str, Capability]:
    """某训练类型适用的能力子集（供前端生成 + 教师端渲染）。"""
    return {k: c for k, c in ALL_CAPABILITIES.items() if _applies(c, training_type)}


def resolve_features(
    snapshot: dict | None = None,
    overrides: dict[str, bool] | None = None,
    training_type: str | None = None,
) -> dict[str, bool]:
    """单一真相：把默认/分层/快照/覆盖/依赖统一解析为最终 features。

    - builtin 恒 True，不可被 snapshot/overrides 关闭。
    - toggleable 取 default，再被 snapshot、overrides 依次覆盖。
    - training_type 非 None 时，仅解析适用于该类型的能力。
    - 递归应用 requires：开启的能力强制开启其依赖。
    """
    result: dict[str, bool] = {}
    for k, cap in ALL_CAPABILITIES.items():
        if not _applies(cap, training_type):
            continue
        result[k] = True if cap.tier == "builtin" else cap.default

    def _overlay(src: dict[str, bool] | None) -> None:
        if not src:
            return
        for k, v in src.items():
            cap = ALL_CAPABILITIES.get(k)
            # builtin 不可关；仅覆盖适用且可开关的键
            if cap and cap.tier == "toggleable" and k in result:
                result[k] = bool(v)

    _overlay(snapshot.get("features", {}) if snapshot else None)
    _overlay(overrides)

    # 递归应用 requires（如 patient_initiative requires emotion）
    changed = True
    while changed:
        changed = False
        for k, cap in ALL_CAPABILITIES.items():
            if result.get(k):
                for req in cap.requires:
                    if req in result and not result[req]:
                        result[req] = True
                        changed = True
    return result


def is_enabled(record, key: str) -> bool:
    return resolve_features(getattr(record, "practice_snapshot", None)).get(key, False)
