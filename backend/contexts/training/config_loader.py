"""SessionConfig loader — 从 JSON 预设文件加载会话配置。"""

import json
from pathlib import Path

_CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "session_configs"
_cache: dict[str, dict] = {}


def _load_all() -> dict[str, dict]:
    if not _cache:
        for f in sorted(_CONFIG_DIR.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                _cache[data.get("id", f.stem)] = data
            except (json.JSONDecodeError, OSError):
                continue
    return _cache


def get_config(config_id: str) -> dict | None:
    return _load_all().get(config_id)


def list_configs() -> list[dict]:
    return list(_load_all().values())


def get_default_config() -> dict:
    config = get_config("standard-assessment")
    if config:
        return config
    configs = list_configs()
    if configs:
        return configs[0]
    return {}
