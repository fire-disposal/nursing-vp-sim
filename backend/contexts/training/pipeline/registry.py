"""Pipeline registry — dynamically assembles middleware chains per feature flags."""


def get_pipeline(feature_flags: dict[str, bool] | None = None) -> list:
    flags = feature_flags or {}
    return build_pipeline(flags)


def build_pipeline(feature_flags: dict[str, bool]) -> list:
    from plugins.manager import get_plugin_manager

    pm = get_plugin_manager()
    return pm.build_pipeline(feature_flags)
