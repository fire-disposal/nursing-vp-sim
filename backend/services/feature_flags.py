from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureFlag:
    key: str
    label: str
    default: bool
    description: str


FEATURE_FLAGS: dict[str, FeatureFlag] = {
    "physical_exam": FeatureFlag(
        key="physical_exam",
        label="护理查体",
        default=False,
        description="允许学生触发护理操作（测血压/体温/听诊等），操作结果通过 Author's Note 注入 LLM",
    ),
    "patient_initiative": FeatureFlag(
        key="patient_initiative",
        label="患者主动追问",
        default=False,
        description="患者根据性格/情绪/等待时长主动发言（催促、担忧、非语言线索等）",
    ),
}


def resolve_features(config_snapshot: dict | None) -> dict[str, bool]:
    result = {k: v.default for k, v in FEATURE_FLAGS.items()}
    if config_snapshot:
        for k, v in config_snapshot.get("features", {}).items():
            if k in result:
                result[k] = v
    return result


def is_enabled(record, key: str) -> bool:
    """检查 TrainingRecord 的某个 feature flag 是否启用。
    
    record: 需有 config_snapshot 属性的 ORM 对象（如 TrainingRecord 实例）。
    """
    return resolve_features(record.config_snapshot).get(key, False)
