import json
import logging
from pathlib import Path

_logger = logging.getLogger(__name__)

_catalog: dict | None = None


def _load() -> dict:
    global _catalog
    if _catalog is None:
        path = Path(__file__).parent.parent / "providers.json"
        _catalog = json.loads(path.read_text(encoding="utf-8"))
    return _catalog


def get_catalog() -> dict:
    return _load()


def match_provider(base_url: str) -> dict | None:
    catalog = _load()
    for p in catalog["providers"]:
        if p["base_url"] and base_url.startswith(p["base_url"]):
            return p
    return None


def infer_provider_name(base_url: str) -> str:
    if not base_url:
        return "unknown"
    p = match_provider(base_url)
    return p["id"] if p else base_url.rsplit("://", maxsplit=1)[-1].split("/", maxsplit=1)[0]


def get_models_for(base_url: str) -> list[dict]:
    p = match_provider(base_url)
    if p:
        return p.get("models", [])
    return []
