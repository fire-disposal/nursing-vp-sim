"""SessionConfig loader — 从 JSON 预设文件加载会话配置。"""

import json
from pathlib import Path
from typing import Optional

_CONFIG_DIR = Path(__file__).parent.parent / "data" / "session_configs"
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


def get_config(config_id: str) -> Optional[dict]:
    return _load_all().get(config_id)


def list_configs() -> list[dict]:
    return list(_load_all().values())


def get_default_config() -> dict:
    return get_config("standard-assessment") or list_configs()[0]
