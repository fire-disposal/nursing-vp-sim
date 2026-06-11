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
    "emotion": FeatureFlag(
        key="emotion",
        label="患者情绪状态机",
        default=False,
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化，注入 author_note 影响患者表现",
    ),
    "patient_initiative": FeatureFlag(
        key="patient_initiative",
        label="患者主动追问",
        default=False,
        description="患者根据性格/情绪/等待时长主动发言（催促、担忧、非语言线索等）",
    ),
    "portrait": FeatureFlag(
        key="portrait",
        label="患者立绘",
        default=False,
        description="在训练界面显示患者人物立绘图片",
    ),
    "questionnaire": FeatureFlag(
        key="questionnaire",
        label="问卷评估",
        default=False,
        description="训练结束后弹出评估问卷供学生填写",
    ),
    "exam_emotion_bridge": FeatureFlag(
        key="exam_emotion_bridge",
        label="查体-情绪联动",
        default=False,
        description="查体操作影响患者心态：缺乏解释或不相关检查会降低信任/舒适度",
    ),
    "allow_pause": FeatureFlag(
        key="allow_pause",
        label="允许暂停计时",
        default=False,
        description="允许学生在训练中暂停倒计时。后台结算仍以服务器时间为准。",
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
