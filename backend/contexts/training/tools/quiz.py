"""Quiz tool handler — serves quiz config and records student answers."""

from __future__ import annotations

import logging

from contexts.training.capabilities import is_enabled

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)


class QuizHandler(ToolHandler):
    tool_name = "quiz"

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        if not is_enabled(ctx.record, "quiz"):
            return ToolResult(ok=False, error="本次训练未启用引导题目")

        if action == "load":
            return self._load(ctx)

        if action == "submit":
            question_id = params.get("question_id", "")
            answer = params.get("answer", "")
            if not question_id:
                return ToolResult(ok=False, error="Missing question_id")
            return self._submit(question_id, answer, ctx)

        return ToolResult(ok=False, error=f"Unknown action: {action}")

    def _load(self, ctx: ToolContext) -> ToolResult:
        quiz_config = ctx.case_data.get("quiz")
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
        quiz_config = ctx.case_data.get("quiz")
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

        rs = dict(ctx.record.runtime_state or {})
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
