from dataclasses import dataclass


@dataclass(frozen=True)
class Capability:
    key: str
    label: str
    default: bool
    description: str


ALL_CAPABILITIES: dict[str, Capability] = {
    "patient_initiative": Capability(
        key="patient_initiative",
        label="患者主动追问",
        default=False,
        description="患者根据性格/情绪/等待时长主动发言",
    ),
    "emotion": Capability(
        key="emotion",
        label="患者情绪状态机",
        default=False,
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化",
    ),
    "physical_exam": Capability(
        key="physical_exam",
        label="护理查体",
        default=False,
        description="允许学生触发护理操作（测血压/体温/听诊等）",
    ),
    "questionnaire": Capability(
        key="questionnaire",
        label="问卷评估",
        default=False,
        description="训练结束后向学生推送问卷调查",
    ),
}


def all_capabilities() -> dict[str, Capability]:
    return dict(ALL_CAPABILITIES)


def resolve_features(snapshot: dict | None = None, overrides: dict[str, bool] | None = None) -> dict[str, bool]:
    result = {k: v.default for k, v in ALL_CAPABILITIES.items()}
    if snapshot:
        for k, v in snapshot.get("features", {}).items():
            if k in result:
                result[k] = v
    if overrides:
        for k, v in overrides.items():
            if k in result:
                result[k] = v
    if result.get("patient_initiative"):
        result["emotion"] = True
    return result


def is_enabled(record, key: str) -> bool:
    return resolve_features(getattr(record, "practice_snapshot", None)).get(key, False)
