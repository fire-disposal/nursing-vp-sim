"""患者角色守卫模块

纯 Python 规则检测 + 二次 LLM 修正。
策略：先放行原文流式输出，仅在检测到严重越界时调用 LLM 修正。
"""
import logging
import re

log = logging.getLogger(__name__)

ROLE_LEAK_PATTERNS = [
    "作为护士", "作为医生", "作为老师", "作为AI", "我是AI", "我是人工智能",
    "我是语言模型", "作为语言模型", "由AI", "由人工智能", "我是虚拟患者",
    "我是病例", "根据系统", "根据设定", "你应该问", "你可以询问",
    "你可以继续问", "建议你询问", "你漏掉了", "你还没有问", "你忘了问",
    "你遗漏了", "评分标准", "教学反馈", "我建议你", "正确的问诊",
    "护理学生应该", "你问得很好", "你问得不错", "下一个该问",
    "请继续问诊", "根据病例", "根据我的病历", "作为患者角色",
    "我是一个AI", "角色扮演", "按照设定", "你应该关注", "你的任务是",
    "你可以问一下", "这位患者", "本患者", "该患者",
]

DIAGNOSIS_PATTERNS = [
    "诊断为", "我判断", "应该是", "急性加重", "护理诊断为", "糖尿病足",
    "感染扩散", "需要抗生素", "你患有", "你得了", "你可能得了",
    "这属于", "并发症是", "治疗方案", "需要住院",
]

TEACHING_LEAK_PATTERNS = [
    "你应该继续", "你还需要问", "建议你", "这次训练", "你的表现",
    "不完整", "不正确", "该问的",
]

LONG_OUTPUT_LIMIT = 400

UNKNOWN_FALLBACKS = [
    "这个我不太清楚，平时也没太注意。",
    "这个我记不太清了。",
    "这方面我说不准，之前也没人跟我详细说过。",
    "这个医生没跟我说过，我也不太明白。",
]

ADDRESSING_SKIP_PREFIXES = ["医生说", "以前医生", "医生给我", "医生让我", "医生开", "医生说过的"]


def detect_violations(reply: str) -> tuple[str | None, str | None, str | None]:
    """检测回复中的越界问题，返回 (role_leak, diagnosis, teaching)"""
    role = check_role_leak(reply)
    diag = check_diagnosis_leak(reply)
    teach = check_teaching_leak(reply)
    return role, diag, teach


def has_critical_violation(reply: str) -> bool:
    role, diag, teach = detect_violations(reply)
    return role is not None or diag is not None or teach is not None


def check_role_leak(reply: str) -> str | None:
    for pattern in ROLE_LEAK_PATTERNS:
        if pattern in reply:
            return pattern
    return None


def check_diagnosis_leak(reply: str) -> str | None:
    for pattern in DIAGNOSIS_PATTERNS:
        if pattern in reply:
            return pattern
    return None


def check_teaching_leak(reply: str) -> str | None:
    for pattern in TEACHING_LEAK_PATTERNS:
        if pattern in reply:
            return pattern
    return None


def normalize_addressing_to_nurse(reply: str) -> str:
    """将患者对学生的直接称呼从'医生/大夫/医师'归一化为'护士'"""
    if not reply or not reply.strip():
        return reply
    text = reply.strip()
    for prefix in ADDRESSING_SKIP_PREFIXES:
        if text.startswith(prefix):
            return reply
    for title in ["医生", "大夫", "医师"]:
        m = re.match(r"^([^\u4e00-\u9fff]*)" + re.escape(title) + r"(你好|您好|，|,)", text)
        if m:
            return m.group(1) + "护士" + m.group(2) + text[m.end():]
    return reply


async def correct_via_llm(original: str, violations: list[str], client, router, log_worker, user_id: int, record_id: int, case_id: int) -> str:
    """调用 LLM 修正角色越界回复。共用 call_llm 基础设施并记录日志。"""
    violation_desc = "\n".join(f"- {v}" for v in violations)
    messages = [
        {
            "role": "system",
            "content": (
                "修正以下虚拟患者回复中的角色越界问题，保留原文语气和信息。\n"
                f"问题: {violation_desc}\n"
                "规则: 去除 AI/教学口吻，去除对学生评价，诊断改为患者式模糊表达。"
            ),
        },
        {"role": "user", "content": original},
    ]
    log.info("guard LLM 修正: violations=%d text_len=%d", len(violations), len(original))
    try:
        from config import get_llm_config

        from services.llm_service import call_llm

        cfg = get_llm_config("patient_chat")
        corrected = await call_llm(
            messages,
            purpose="patient_chat",
            temperature=0.3,
            max_tokens=min(cfg.get("max_tokens", 512), 512),
            timeout=cfg.get("timeout", 15),
            max_retries=1,
            user_id=user_id,
            record_id=record_id,
            case_id=case_id,
            client=client,
            router=router,
            log_worker=log_worker,
        )
        result = corrected.strip() or original
        if result != original:
            log.info("guard LLM 修正完成: before=%d after=%d", len(original), len(result))
        return result
    except Exception:
        log.exception("guard LLM 修正失败，回退原文")
        return original


def sanitize_patient_reply(reply: str, case_data: dict) -> tuple[str, list[str], bool]:
    """检测回复中的问题。返回 (normalized, violations, needs_correction)。
    needs_correction=True 表示存在严重越界需要 LLM 二次修正。
    """
    violations: list[str] = []

    normalized = normalize_addressing_to_nurse(reply)
    if normalized != reply:
        violations.append("称谓归一化: 医生/大夫/医师 -> 护士")

    leak = check_role_leak(normalized)
    if leak:
        violations.append(f"角色越界: {leak}")

    diag = check_diagnosis_leak(normalized)
    if diag:
        violations.append(f"诊断化: {diag}")

    teach = check_teaching_leak(normalized)
    if teach:
        violations.append(f"教学反馈: {teach}")

    needs_correction = bool(leak or diag or teach)

    if not needs_correction and len(normalized) > LONG_OUTPUT_LIMIT:
        return normalized[:300] + "...", violations + [f"截断: {len(normalized)}字"], False

    return normalized, violations, needs_correction
