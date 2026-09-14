"""教师端病例列表的 capabilities 必须由 tools.* 派生（与学生端 /api/cases 同源）。"""

import json
from datetime import UTC, datetime
from pathlib import Path

from models import Case
from modules.cases.service import CaseService

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cases"


def _case(name: str) -> Case:
    data = json.loads((CASES_DIR / f"{name}.json").read_text(encoding="utf-8"))
    return Case(
        id=1,
        name=data["name"],
        description=data.get("description", ""),
        training_type="history_taking",
        case_data=data,
        created_at=datetime.now(UTC),
    )


def test_manage_view_capabilities_derive_from_tools():
    view = CaseService(None)._manage_view(_case("case1"))

    assert view.capabilities["physical_exam"] is True
    assert view.capabilities["nursing_record"] is True


def test_manage_view_ignores_stored_capabilities_field():
    """库中遗留的 capabilities 存储字段不是真相 —— 真相是 tools.*。"""
    case = _case("case1")
    case.case_data = {**case.case_data, "capabilities": {"physical_exam": False}}

    view = CaseService(None)._manage_view(case)

    assert view.capabilities["physical_exam"] is True
