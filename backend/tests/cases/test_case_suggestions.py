"""病例 AI 审阅：真实服务链路的替身 LLM 测试，不调用外部模型。"""

from types import SimpleNamespace

import pytest

from models import Case
from modules.cases.generation import suggest_case
from modules.cases.service import CaseService
from schemas import CaseSuggestionRequest


class _FakeLLM:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def call_json(self, messages, **kwargs):
        self.messages = messages
        kwargs["ctx"].usage = {"total_tokens": 24}
        return {
            "suggestions": [
                {"field": "scenario", "title": "补全场景边界", "detail": "说明学生开局知道什么。"},
                {"field": "", "title": "", "detail": "空标题应被过滤"},
            ]
        }


@pytest.mark.asyncio
@pytest.mark.parametrize("workflow", ["history_taking", "clinical_reasoning"])
async def test_case_suggestions_use_current_unsaved_workflow(workflow):
    llm = _FakeLLM()
    request = CaseSuggestionRequest(
        workflow=workflow,
        current_case_data={"workflow": workflow, "name": "未保存病例"},
        focus="检查内容边界",
    )

    response = await suggest_case(request, SimpleNamespace(id=1), llm)

    assert response.suggestions[0].field == "scenario"
    assert response.suggestions[0].title == "补全场景边界"
    assert len(response.suggestions) == 1
    assert response.usage == {"total_tokens": 24}
    prompt = llm.messages[0]["content"]
    assert f"目标格式：{workflow}" in prompt
    assert "未保存病例" in prompt
    assert "检查内容边界" in prompt


def test_manage_view_exposes_registered_case_workflow():
    case = Case(
        name="V2 病例",
        description="",
        case_data={"workflow": "clinical_reasoning"},
        status="draft",
        difficulty=2,
        time_limit_minutes=30,
        is_open=False,
    )

    view = CaseService(SimpleNamespace())._manage_view(case, 0)

    assert view.workflow.id == "clinical_reasoning"
    assert view.workflow.runtime_ready is True
