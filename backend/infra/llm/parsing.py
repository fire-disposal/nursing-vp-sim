"""LLM 响应 JSON 解析工具 —— 容错解析 + 截断修复 + 截断分类。

三层兜底（逐级降级，全部失败才抛）：

1. 直接解析（先去 ``<thinking>`` 段落、代码围栏与前后散文）；
2. 容忍尾随逗号后再解析；
3. **补全被截断的 JSON**：只补闭合符，且补出的候选必须**自身可解析**才返回
   （旧实现不校验，返回过自身都不能解析的串，于是三层兜底一起失效）；
4. 关键字段正则提取（结构已无法修复时的最后手段）。

失败分两类，调用方必须区分（评分链路的真实故障正源于此）：

* :class:`TruncatedJSONError` —— 输出**被截断**（结构在结尾处不完整：括号未闭合、
  或 JSONDecodeError 正好落在文本末尾）。这类失败应当**压缩输出后重试**，
  绝不能当成"模型返回空"。
* 其余 ``ValueError`` —— 根本不是 JSON（例如模型回了散文）。
"""

import json
import re


class TruncatedJSONError(ValueError):
    """LLM 输出被截断（JSON 结构在结尾处不完整），不是"空响应"。"""


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


def _scan_structure(text: str) -> tuple[int, int, bool, int]:
    """转义感知的结构扫描。

    返回 ``(未闭合花括号数, 未闭合方括号数, 是否停在字符串内, 该字符串起始引号下标)``。

    为什么必须转义感知：中文长文本里常有 ``\\"`` 转义引号与反斜杠，用
    ``text[i-1] != "\\\\"`` 这种朴素判定会把引号配对判错，括号计数随之错位
    —— 2026-09-27 评分为 0 的真实故障里，补全逻辑因此多补了 3 个 ``}``。
    """
    braces = brackets = 0
    in_string = False
    escape = False
    string_open = -1
    for index, char in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            string_open = index
        elif char == "{":
            braces += 1
        elif char == "}":
            braces -= 1
        elif char == "[":
            brackets += 1
        elif char == "]":
            brackets -= 1
    return braces, brackets, in_string, string_open


def _looks_truncated(text: str) -> bool:
    """文本是否"被截断"（而不是"根本不是 JSON"）。"""
    braces, brackets, in_string, _ = _scan_structure(text)
    if in_string or braces > 0 or brackets > 0:
        return True
    try:
        json.loads(text)
    except json.JSONDecodeError as exc:
        # 报错点落在文本末尾 ⇒ 结构在结尾处不够，属截断特征
        return exc.pos >= len(text) - 3
    return False


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

    repaired = _repair_truncated_json(text)
    if repaired:
        return json.loads(repaired)

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
        if _looks_truncated(text):
            braces, brackets, _, _ = _scan_structure(text)
            raise TruncatedJSONError(
                f"LLM 输出被截断，无法补全为完整 JSON（len={len(text)}，未闭合花括号={braces}，"
                f"未闭合方括号={brackets}）: {text[-200:]}"
            )
        raise ValueError(f"无法解析LLM返回的JSON: {text[:500]}")
    return result


def _repair_truncated_json(text: str) -> str | None:
    """补全被截断的 JSON（只补闭合符），返回**可解析**的候选；补不出就返回 ``None``。

    与旧实现的两处差别（都是真实故障的成因）：

    1. 括号/方括号计数改成转义感知（见 :func:`_scan_structure`），不再被中文串里的
       ``\\"`` 带偏；
    2. **补完必须 json.loads 通过** 才返回 —— 返回"看起来闭合了但其实解析不了"的串，
       等于把三层兜底一次性废掉。

    截断发生在字符串内部时，丢掉这个不完整的值（连同它的键）而不是补一个空串：
    给评分结果塞 ``""`` 是在伪造"该字段为空"。
    """
    if not text or not text.strip().startswith("{"):
        return None
    candidate = text.rstrip()
    braces, brackets, in_string, string_open = _scan_structure(candidate)
    if in_string:
        keep = candidate.rfind(",", 0, string_open)
        if keep <= 0:
            return None
        candidate = candidate[:keep]
        braces, brackets, _, _ = _scan_structure(candidate)
    if braces <= 0 and brackets <= 0:
        return None
    candidate += "]" * max(0, brackets) + "}" * max(0, braces)
    try:
        json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return candidate
