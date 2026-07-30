import json
from pathlib import Path

_RUBRIC_PATH = Path(__file__).parent / "rubric.json"


def _load_from_json() -> dict:
    with open(_RUBRIC_PATH, encoding="utf-8") as f:
        return json.load(f)


RUBRIC = _load_from_json()
