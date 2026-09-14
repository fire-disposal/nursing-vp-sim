"""确定性敌意预闸 — 辱骂 / 诅咒 / 人身攻击的词表识别。

**为什么需要它**：情绪 LLM 是概率模型，对「我日你妈」「去死吧」这类边界输入可能
判断为"口头禅/玩笑"而只给 ``judgmental_language``，于是升级阶梯（连续辱骂 → 敌意区
→ 患者中止访谈）变成模型自由心证。本模块在**调用 LLM 之前**先做确定性匹配，命中即
直接产出 ``EmotionEventType.INSULT``（confidence 1.0）；LLM 只负责渐变语气的判断。

**边界（有意保守，避免误伤）**：
- 只收「针对患者本人」的辱骂、死亡诅咒、人身攻击。一般粗口/口头禅（"妈的"、"我去"、
  "tmd"）以及只指责病情或生活习惯的说法，仍交给 LLM 判 ``judgmental_language``。
- 医疗语境歧义词不入表（裸「神经病」「脑瘫」「智障」会撞上"有没有神经病史"这类问诊），
  改用第二人称框架（``你…智障``）或换用无歧义说法。
- 用短语而非裸字（「滚出去/滚蛋」而不是「滚」，避免"翻滚"）。

**维护方式**：
- 新增一条 = 在 ``_PATTERNS`` 加一行 ``(正则, 标签)`` + 在
  ``tests/training/emotion/test_hostility.py`` 加一个正例（必要时加反例）。
- 匹配在 ``find_hostile_text`` 里对原文做 ``re.search``（不分词、不做拼音还原）。
- **不要在这里编码升级次数**：几次辱骂进入敌意区/中止访谈，由 ``rules.INSULT`` 的
  delta 与 ``behavior`` 的阈值决定；本模块只回答"这句话是不是辱骂"。
"""

from __future__ import annotations

import re

from .events import DetectedEmotionEvent, EmotionEventType

# ── 词表：(正则, 标签) ──
# 标签只出现在日志/evidence 里，用于人工核对命中原因。
_PATTERNS: tuple[tuple[str, str], ...] = (
    # 亲属辱骂 / 脏话（"我日你妈""操你妈""草泥马""你妈逼"）
    (r"[我卧]?[日操草肏][你尼][妈马]", "亲属辱骂"),
    (r"[你尼][妈马][了个]?[逼bB]", "亲属辱骂"),
    # 死亡诅咒
    (r"去死", "死亡诅咒"),
    # 人格羞辱（无歧义，可直接匹配）
    (r"傻[逼比bB屌叉xX]|煞笔|沙比|傻缺", "人格羞辱"),
    (r"畜生|杂种|王八蛋|混蛋|狗东西|贱人|贱货", "人格羞辱"),
    (r"老不死", "人格羞辱"),
    (r"你算什么东西|你是什么东西|不是个东西", "人格羞辱"),
    # 人身攻击：第二人称 + 贬损名词（避免"智障病史"这类问诊误伤）
    (r"(你|您)[这真是就个简直]{0,5}(废物|垃圾|蠢货|蠢猪|蠢驴|白痴|智障|弱智|脑残|傻子|窝囊废)", "人身攻击"),
    (r"(你|您)(是不是)?有病(啊|吧|么)", "人身攻击"),
    # 驱赶
    (r"滚出去|滚蛋|滚开|给我滚|滚远点", "驱赶"),
    # 英文辱骂（少量常见词，加词边界避免命中普通词）
    (r"(?<![a-z])(fuck|bitch|asshole|bastard|idiot|moron|dumbass|stfu)(?![a-z])", "英文辱骂"),
    # 拼音缩写（cnm=操你妈 / nmsl=你妈死了 / mdzz=妈的智障）
    (r"(?<![a-z])(cnm|nmsl|mdzz)(?![a-z])", "亲属辱骂"),
)

_COMPILED: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern, re.IGNORECASE), label) for pattern, label in _PATTERNS
)


def find_hostile_text(text: str) -> list[str]:
    """返回原文中命中的敌意片段（``"片段(标签)"``，去重且保持出现顺序）。"""
    if not text:
        return []

    hits: list[str] = []
    seen: set[str] = set()
    for pattern, label in _COMPILED:
        for match in pattern.finditer(text):
            hit = f"{match.group(0)}({label})"
            if hit not in seen:
                seen.add(hit)
                hits.append(hit)
    return hits


def detect_hostile_event(text: str) -> DetectedEmotionEvent | None:
    """确定性判定：命中词表即返回 INSULT 事件（confidence 1.0），否则 None。

    confidence 固定 1.0：这是词表命中，不是模型推断；规则引擎按 confidence 缩放
    delta（见 ``engine.apply_events``），1.0 即取 ``rules.INSULT`` 的完整量级。
    """
    hits = find_hostile_text(text)
    if not hits:
        return None
    return DetectedEmotionEvent(
        type=EmotionEventType.INSULT,
        confidence=1.0,
        evidence="词表命中：" + "、".join(hits),
    )
