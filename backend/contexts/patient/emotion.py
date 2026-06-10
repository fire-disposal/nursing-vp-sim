"""患者情绪状态机 — 2D 信赖-舒适模型

信赖 (trust):    0-100  对护士专业能力的信任度
舒适 (comfort):  0-100  情感上的安全感和放松度

每轮学生输入通过关键词匹配产生 (trust_delta, comfort_delta) 双通道调整，
结果映射为 5 个显示标签（向后兼容 UI），并生成 Author's Note 注入 LLM prompt。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from infrastructure.cache import EmotionCache

log = logging.getLogger(__name__)

# ── 显示标签映射（向后兼容） ──
# (信赖, 舒适) → 标签
STATE_LABELS: list[tuple[tuple[int, int], str, str]] = [
    ((30, 30), "withdrawn", "沉默敷衍，回答极其简短"),
    ((30, 0),  "defensive", "防御抵触，需要安抚"),
    ((30, 60), "neutral",   "正常配合，有所保留"),
    ((0,  60), "relaxed",   "放松配合，语气友好"),
    ((70, 70), "open",      "开放信任，愿意详述"),
]


def _lookup_state(trust: int, comfort: int) -> tuple[str, str]:
    for (t_min, c_min), label, desc in STATE_LABELS:
        if trust >= t_min and comfort >= c_min:
            return label, desc
    return "neutral", "正常配合"


# ── 意图 → (trust_delta, comfort_delta) ──
INTENT_TRANSITIONS: dict[str, tuple[int, int]] = {
    "关心/共情":   (5,  15),  # 共情主要提升舒适，轻微提升信赖
    "解释原因":    (15, 5),   # 解释原因主要提升信赖
    "道歉/安抚":   (3,  12),  # 道歉主要恢复舒适
    "粗鲁/指责":   (-10, -15), # 粗鲁同时打击两个维度
    "追问隐私":    (-5,  -12), # 隐私追问主要打击舒适
    "催促":        (0,  -10), # 催促降低舒适
    "不明确":      (-3, -3),   # 模糊回应轻微双降
    "普通提问":    (0,  0),    # 普通提问不变
}

INTENT_KEYWORDS: dict[str, list[str]] = {
    "关心/共情":    ["别担心", "没关系", "慢慢说", "理解", "辛苦", "不容易", "放心", "会好的", "别着急", "别怕"],
    "解释原因":     ["因为", "原因是", "为了评估", "需要了解", "方便", "以便", "这样才能", "给你检查"],
    "道歉/安抚":    ["抱歉", "对不起", "不好意思", "不是故意", "打扰", "原谅"],
    "粗鲁/指责":    ["必须", "快点", "你怎么", "认真点", "赶紧", "别废话", "烦", "太慢"],
    "追问隐私":     ["抽烟", "喝酒", "工资", "结婚", "家庭", "经济", "收入", "男朋友", "女朋友"],
    "催促":         ["快点", "速度", "等不及", "着急", "还要多久"],
    "不明确":       ["嗯", "哦", "好", "行", "知道了", "随便"],
}


def classify_intent(msg: str) -> str:
    if not msg:
        return "普通提问"
    msg_lower = msg.lower()
    for intent, keywords in INTENT_KEYWORDS.items():
        if any(kw in msg_lower for kw in keywords):
            return intent
    return "普通提问"


# ── 状态对象 ──

@dataclass
class EmotionState:
    trust: int = 50
    comfort: int = 50
    history: list[dict] = field(default_factory=list)

    @property
    def state(self) -> str:
        label, _ = _lookup_state(self.trust, self.comfort)
        return label

    @property
    def note(self) -> str:
        return _build_author_note(self.trust, self.comfort)

    def update(self, intent: str) -> None:
        dt, dc = INTENT_TRANSITIONS.get(intent, (0, 0))
        if dt == 0 and dc == 0 and intent != "普通提问":
            return  # 未知意图，不更新

        old_trust, old_comfort = self.trust, self.comfort
        self.trust = max(0, min(100, self.trust + dt))
        self.comfort = max(0, min(100, self.comfort + dc))

        old_state = _lookup_state(old_trust, old_comfort)[0]
        new_state = _lookup_state(self.trust, self.comfort)[0]

        if old_state != new_state or dt != 0 or dc != 0:
            self.history.append({
                "trust": self.trust,
                "comfort": self.comfort,
                "state": new_state,
                "intent": intent,
                "timestamp": datetime.now(UTC).isoformat(),
            })
            log.debug(
                "情绪变化: %s(t=%d,c=%d) → %s(t=%d,c=%d) [意图: %s]",
                old_state, old_trust, old_comfort,
                new_state, self.trust, self.comfort,
                intent,
            )


def _build_author_note(trust: int, comfort: int) -> str:
    label, desc = _lookup_state(trust, comfort)
    parts = [f"信赖: {trust} | 舒适: {comfort}"]

    if trust < 30:
        parts.append("患者对护士专业能力存疑")
    elif trust < 60:
        parts.append("患者基本配合但保留")
    else:
        parts.append("患者信任护士的专业判断")

    if comfort < 30:
        parts.append("情绪紧张不安，回答简短回避")
    elif comfort < 60:
        parts.append("情绪平稳，按常规节奏交流")
    else:
        parts.append("心情放松，愿意开放交流")

    extra = {
        "withdrawn": "需要解释操作目的并表达真诚关心才能缓和",
        "defensive": "如果继续追问隐私而不解释原因，可能恶化",
        "neutral": "患者保持一定距离，按真实感受回答",
        "relaxed": "患者心情放松，可能多聊一两句个人感受",
        "open": "患者对护士建立了信任，可能主动透露额外信息",
    }
    parts.append(extra.get(label, ""))

    return "【" + " | ".join(parts) + "】"


# ── 缓存 API（使用 EmotionCache 实例） ──

def get_emotion(record_id: int, cache: EmotionCache) -> EmotionState:
    state = cache.get(record_id)
    if state is None or not isinstance(state, EmotionState):
        state = EmotionState()
        cache.set(record_id, state)
    return state


def cleanup_emotion(record_id: int, cache: EmotionCache) -> None:
    cache.cleanup(record_id)
