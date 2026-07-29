"""LLM 响应 JSON 解析工具 —— 容错解析 + 截断修复"""

import json
import re


def _extract_json_value(text: str, start: int) -> tuple[dict, int] | None:
    max_depth = 15
    depth = 0
    for i, ch in enumerate(text[start:], start=start):
        if ch == "{":
            depth += 1
            if depth > max_depth:
                return None
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    decoder = json.JSONDecoder()
                    obj, end = decoder.raw_decode(text, start)
                    return obj, end
                except json.JSONDecodeError:
                    return None
    return None


def safe_parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"<thinking>[\s\S]*?</thinking>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^```(?:json)?\s*\n?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n?\s*```\s*$", "", text)
    text = text.strip()

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    try:
        cleaned = re.sub(r",\s*}", "}", text)
        cleaned = re.sub(r",\s*]", "]", cleaned)
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    try:
        repaired = _repair_truncated_json(text)
        if repaired:
            return json.loads(repaired)
    except json.JSONDecodeError:
        pass

    result = {}
    for field in ["total_score", "strengths", "weaknesses", "missed_content", "suggestions", "detail_scores"]:
        if field == "total_score":
            m = re.search(r'"total_score"\s*:\s*(-?\d+(?:\.\d+)?)', text)
            if m:
                val = m.group(1)
                result["total_score"] = float(val) if "." in val else int(val)
        elif field == "suggestions":
            m = re.search(r'"suggestions"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
            if m:
                result["suggestions"] = m.group(1)
        elif field in ("strengths", "weaknesses", "missed_content"):
            m = re.search(rf'"{field}"\s*:\s*\[([^\]]*)\]', text)
            if m:
                items = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
                result[field] = items
        elif field == "detail_scores":
            idx = text.find('"detail_scores"')
            if idx != -1:
                colon = text.find(":", idx + 15)
                if colon != -1:
                    parsed = _extract_json_value(text, colon + 1)
                    if parsed:
                        result["detail_scores"] = parsed[0]

    if not result or ("total_score" not in result and "detail_scores" not in result):
        raise ValueError(f"无法解析LLM返回的JSON: {text[:500]}")
    return result


def _repair_truncated_json(text: str) -> str | None:
    if not text or not text.strip().startswith("{"):
        return None
    if text.rstrip().endswith('"'):
        pass
    else:
        last_quote = text.rfind('"')
        if last_quote > len(text) // 2:
            text = text[: last_quote + 1]
    open_braces = text.count("{") - text.count("}")
    open_brackets = text.count("[") - text.count("]")
    in_string = False
    for i, ch in enumerate(text):
        if ch == '"' and (i == 0 or text[i - 1] != "\\"):
            in_string = not in_string
    if in_string:
        text += '"'
    text += "]" * open_brackets
    text += "}" * open_braces
    if open_braces > 0 or open_brackets > 0:
        return text
    return None
