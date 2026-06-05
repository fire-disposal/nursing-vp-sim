import re
from core.config import AUTO_SCORE_COVERED_INQUIRIES_MIN, AUTO_SCORE_STUDENT_CHARS_MIN, AUTO_SCORE_AI_CHARS_MIN


def count_covered_inquiries(inquiries: list[str], student_text: str) -> int:
    if not inquiries:
        return 0
    covered = 0
    for inquiry in inquiries:
        cleaned = re.sub(r"[（）()]", " ", inquiry)
        tokens = set()
        for i in range(len(cleaned) - 1):
            token = cleaned[i:i + 2]
            if token.strip():
                tokens.add(token)
        if any(token in student_text for token in tokens):
            covered += 1
    return covered


def should_auto_score(messages, case_data: dict) -> bool:
    inquiries = case_data.get("required_inquiries", [])
    student_text = "".join(m.content for m in messages if getattr(m, "role", None) == "student")
    ai_text = "".join(m.content for m in messages if getattr(m, "role", None) == "patient")

    covered = count_covered_inquiries(inquiries, student_text)
    student_chars = len(student_text)
    ai_chars = len(ai_text)

    return (
        covered >= AUTO_SCORE_COVERED_INQUIRIES_MIN
        and student_chars >= AUTO_SCORE_STUDENT_CHARS_MIN
        and ai_chars >= AUTO_SCORE_AI_CHARS_MIN
    )
