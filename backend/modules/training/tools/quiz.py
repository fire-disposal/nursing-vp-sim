"""Quiz tool handler — serves quiz config and records student answers."""

from __future__ import annotations

import logging

from core.exceptions import ValidationError

from .base import ToolContext, ToolHandler, ToolResult, copy_runtime_state

log = logging.getLogger(__name__)


def _quiz_config(case_data: dict) -> dict | None:
    """quiz 的病例配置：``activities.quiz.config``。

    函数内导入：``activities`` 在装配期导入本模块的 handler，模块级反向导入会成环。
    """
    from modules.training.activities import activity_config

    config = activity_config(case_data, "quiz")
    return config if isinstance(config, dict) else None


class QuizHandler(ToolHandler):
    tool_name = "quiz"
    actions = frozenset({"load", "submit"})

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        # action/授权/启用由 registry.dispatch + service._authorize 统一校验
        if action == "load":
            return self._load(ctx)

        question_id = params.get("question_id", "")
        answer = params.get("answer", "")
        if not question_id:
            raise ValidationError(detail="缺少 question_id")
        return self._submit(question_id, answer, ctx)

    def _load(self, ctx: ToolContext) -> ToolResult:
        quiz_config = _quiz_config(ctx.case_data)
        if not quiz_config:
            return ToolResult(ok=True, data={"quiz": None})
        questions = quiz_config.get("questions", [])
        safe_questions = [
            {"id": q.get("id"), "stem": q.get("stem"), "options": q.get("options", [])} for q in questions
        ]
        return ToolResult(
            ok=True,
            data={
                "quiz": {
                    "title": quiz_config.get("title", "引导题目"),
                    "questions": safe_questions,
                },
            },
        )

    def _submit(self, question_id: str, answer: str, ctx: ToolContext) -> ToolResult:
        quiz_config = _quiz_config(ctx.case_data)
        if not quiz_config:
            return ToolResult(ok=False, error="无 quiz 配置")
        questions = quiz_config.get("questions", [])
        target = None
        for q in questions:
            if q.get("id") == question_id:
                target = q
                break

        if not target:
            return ToolResult(ok=False, error=f"题目不存在: {question_id}")

        correct = target.get("answer", "")
        is_correct = answer.strip().upper() == correct.strip().upper()

        rs = copy_runtime_state(ctx)
        quiz_answers = rs.get("quiz_answers", [])
        if not isinstance(quiz_answers, list):
            quiz_answers = []

        existing = next((a for a in quiz_answers if a.get("question_id") == question_id), None)
        if existing:
            existing["answer"] = answer
            existing["correct"] = is_correct
        else:
            quiz_answers.append({"question_id": question_id, "answer": answer, "correct": is_correct})

        rs["quiz_answers"] = quiz_answers
        ctx.record.runtime_state = rs
        ctx.db.flush()

        return ToolResult(
            ok=True,
            data={
                "question_id": question_id,
                "correct": is_correct,
                "correct_answer": correct,
                "explanation": target.get("explanation", ""),
            },
        )
