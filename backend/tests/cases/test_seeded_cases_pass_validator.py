"""内置病例全量过校验器 — 防止数据回归（CI 门禁）。"""

import json
from pathlib import Path

from modules.cases.validator import load_cases_from_dir, validate_cases

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cases"


def test_all_seeded_cases_pass_validator():
    cases = load_cases_from_dir(CASES_DIR)
    reports = validate_cases(cases)
    failed = {fname: [i.message for i in r.errors] for fname, r in reports.items() if r.errors}
    assert not failed, f"内置病例存在校验 error: {failed}"


def test_all_seeded_cases_are_valid_json():
    for p in sorted(CASES_DIR.glob("*.json")):
        json.loads(p.read_text(encoding="utf-8"))
