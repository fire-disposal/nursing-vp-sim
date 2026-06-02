"""患者角色守卫模块

纯 Python 规则检测 —— 不增加 LLM 调用，不拖慢回复速度。
五层安全：称谓归一化 → 角色越界 → 诊断泄露 → 教学反馈 → 长回复截断
"""

import re

ROLE_LEAK_PATTERNS = [
    "作为护士", "作为医生", "作为老师", "作为AI", "我是AI",
    "我是人工智能", "我是语言模型", "作为语言模型", "由AI", "由人工智能",
    "我是虚拟患者", "我是病例", "根据系统", "根据设定",
    "你应该问", "你可以询问", "你可以继续问", "建议你询问",
    "你漏掉了", "你还没有问", "你忘了问", "你遗漏了",
    "评分标准", "教学反馈", "我建议你", "正确的问诊", "护理学生应该",
    "你问得很好", "你问得不错", "下一个该问", "请继续问诊",
    "根据病例", "根据我的病历", "作为患者角色",
    "我是一个AI", "角色扮演", "按照设定",
    "你应该关注", "你的任务是", "你可以问一下",
    "这位患者", "本患者", "该患者",
]

DIAGNOSIS_PATTERNS = [
    "诊断为", "我判断", "应该是", "急性加重", "护理诊断为",
    "糖尿病足", "感染扩散", "需要抗生素",
    "你患有", "你得了", "你可能得了",
    "这属于", "并发症是",
    "治疗方案", "需要住院",
]

# 教学反馈关键词——患者不应评价学生表现
TEACHING_LEAK_PATTERNS = [
    "你应该继续", "你还需要问", "建议你", "这次训练",
    "你的表现", "不完整", "不正确", "该问的",
]

# 长回复阈值（超此字符数触发截断，防止患者长篇大论）
LONG_OUTPUT_LIMIT = 400

UNKNOWN_FALLBACKS = [
    "这个我不太清楚，平时也没太注意。",
    "这个我记不太清了。",
    "这方面我说不准，之前也没人跟我详细说过。",
    "这个医生没跟我说过，我也不太明白。",
]


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
    """检测患者是否以教师/评估者口吻回复——患者不应评价学生表现"""
    for pattern in TEACHING_LEAK_PATTERNS:
        if pattern in reply:
            return pattern
    return None


def check_long_output(reply: str) -> bool:
    """检测回复是否过长（可能包含完整病史泄露）"""
    return len(reply) > LONG_OUTPUT_LIMIT


def get_fallback_reply() -> str:
    """返回一条随机兜底回复"""
    import random
    return random.choice(UNKNOWN_FALLBACKS)


def get_allowed_hidden_info(case_data: dict, student_message: str,
                            disclosed_topics: set) -> list[dict]:
    """根据学生问题和已泄露主题，返回本轮允许透露的隐藏信息"""
    rules = case_data.get("hidden_info_rules", [])
    if not rules:
        # 兼容旧病例格式：没有 rules 但有 hidden_info 列表
        legacy_hidden = case_data.get("hidden_info", [])
        result = []
        for item in legacy_hidden:
            topic = str(item)[:30]
            if topic in disclosed_topics:
                result.append({"topic": topic, "content": item, "triggered": True})
            elif _keyword_match(item, student_message):
                result.append({"topic": topic, "content": item, "triggered": True})
            else:
                result.append({"topic": topic, "content": item, "triggered": False})
        return result

    result = []
    for rule in rules:
        topic = rule.get("topic", "")
        if topic in disclosed_topics or _keyword_match(rule, student_message):
            result.append({**rule, "triggered": True})
        else:
            result.append({**rule, "triggered": False})
    return result


def get_revealed_topics(history_text: str, case_data: dict) -> set:
    """从历史对话中提取已触发的隐藏信息主题"""
    rules = case_data.get("hidden_info_rules", [])
    if not rules:
        return set()
    revealed = set()
    for rule in rules:
        if _keyword_match(rule, history_text):
            revealed.add(rule.get("topic", ""))
    return revealed


def _keyword_match(rule_or_text, target_text: str) -> bool:
    """检查 target_text 是否命中规则的触发关键词"""
    if isinstance(rule_or_text, str):
        return any(kw in target_text for kw in ["血", "咯血", "血丝", "痰中带血"])
    triggers = rule_or_text.get("trigger_keywords", [])
    return any(kw in target_text for kw in triggers)


# 称谓归一化替换表（Section 19 Step 2）
# 只匹配回复开头的直接称呼，不替换病史语境中的"医生"
ADDRESSING_REPLACEMENTS = [
    ("医生你好", "护士你好"),
    ("医生您好", "护士您好"),
    ("医生，", "护士，"),
    ("医生,", "护士,"),
    ("大夫你好", "护士你好"),
    ("大夫您好", "护士您好"),
    ("大夫，", "护士，"),
    ("大夫,", "护士,"),
    ("医师你好", "护士你好"),
    ("医师您好", "护士您好"),
    ("医师，", "护士，"),
    ("医师,", "护士,"),
]

# 不替换的病史语境前缀（保留原样）
ADDRESSING_SKIP_PREFIXES = ["医生说", "医生让我", "医生给我", "医生叫", "医生建议",
                              "那个医生", "门诊医生", "主治医生", "值班医生",
                              "以前医生", "之前医生", "上次医生", "医生没"]


def normalize_addressing_to_nurse(reply: str) -> tuple[str, bool]:
    """将患者对学生的直接称呼从'医生/大夫/医师'归一化为'护士'

    使用正则匹配开头任意非中文字符后的称谓，覆盖"啊，医生你好"等部分匹配情况。
    不替换病史语境中的医生称谓（如"医生说""以前医生"等）。
    返回 (normalized_reply, was_normalized)
    """
    if not reply or not reply.strip():
        return reply, False

    text = reply.strip()

    # 跳过病史语境
    for prefix in ADDRESSING_SKIP_PREFIXES:
        if text.startswith(prefix):
            return reply, False

    # 正则匹配开头任意非中文字符后跟"医生/大夫/医师"+ 问候/标点
    for title in ["医生", "大夫", "医师"]:
        m = re.match(
            r'^([^\u4e00-\u9fff]*)' + re.escape(title) + r'(你好|您好|，|,)',
            text
        )
        if m:
            prefix_chars = m.group(1)
            suffix = m.group(2)
            normalized = prefix_chars + "护士" + suffix + text[m.end():]
            return normalized, True

    return reply, False


def sanitize_patient_reply(reply: str, case_data: dict) -> tuple[str, list[str]]:
    """五层安全后处理：称谓归一化 → 角色越界 → 诊断泄露 → 教学反馈 → 长回复截断"""
    violations = []

    normalized, was_normalized = normalize_addressing_to_nurse(reply)
    if was_normalized:
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

    is_long = check_long_output(normalized)
    if is_long:
        violations.append(f"回复过长: {len(normalized)}字 (上限{LONG_OUTPUT_LIMIT})")

    # 严重越界 → 替换为兜底回复
    if leak or diag or teach:
        return get_fallback_reply(), violations

    # 仅过长 → 截断
    if is_long:
        return normalized[:300] + "...", violations

    return normalized, violations
