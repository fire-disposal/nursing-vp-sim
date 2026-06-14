from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureFlag:
    key: str
    label: str
    default: bool
    description: str


FEATURE_FLAGS: dict[str, FeatureFlag] = {
    "allow_pause": FeatureFlag(
        key="allow_pause",
        label="允许暂停计时",
        default=False,
        description="允许学生在训练中暂停倒计时。后台结算仍以服务器时间为准。",
    ),
}


def _get_all_flags() -> dict[str, FeatureFlag]:
    result = dict(FEATURE_FLAGS)
    try:
        from plugins.manager import get_plugin_manager

        pm = get_plugin_manager()
        for plugin in pm._plugins.values():
            ff = plugin.feature_flag
            if ff is not None:
                result[ff.key] = ff
    except Exception:
        pass
    return result


def all_feature_flags() -> dict[str, FeatureFlag]:
    return _get_all_flags()


def resolve_features(practice_snapshot: dict | None) -> dict[str, bool]:
    result = {k: v.default for k, v in _get_all_flags().items()}
    if practice_snapshot:
        for k, v in practice_snapshot.get("features", {}).items():
            if k in result:
                result[k] = v
    return result


def is_enabled(record, key: str) -> bool:
    """检查 TrainingRecord 的某个 feature flag 是否启用。

    record: 需有 practice_snapshot 属性的 ORM 对象（如 TrainingRecord 实例）。
    """
    return resolve_features(record.practice_snapshot).get(key, False)
