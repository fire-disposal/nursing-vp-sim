"""患者情绪状态机 — 规则驱动的意图分类与情绪调制

5 态模型：withdrawn → defensive → neutral → relaxed → open

每轮根据学生输入意图对情绪 score 做 delta 调整，输出 Author's Note 一行，
注入到 LLM prompt 的 {#author_note#} 变量。
"""

import logging
from datetime import UTC, datetime

from infrastructure.cache import EmotionCache
from infrastructure.cache import EmotionState as CacheEmotionState

log = logging.getLogger(__name__)

EMOTION_LEVELS = {
    -2: ("withdrawn", "沉默敷衍，回答极其简短"),
    -1: ("defensive", "防御抵触，需要安抚"),
    0: ("neutral", "正常配合"),
    1: ("relaxed", "放松配合，语气友好"),
    2: ("open", "开放信任，愿意详述"),
}

STATE_NOTES = {
    "withdrawn": "【当前: 患者沉默寡言，极度回避。回答不超过5字或用'嗯'敷衍。需要真诚关心才可能缓和。】",
    "defensive": "【当前: 患者有防御情绪，回答简短抵触。如果继续追问隐私而不解释原因，可能恶化。】",
    "neutral": "【当前: 患者正常配合，按真实感受回答。】",
    "relaxed": "【当前: 患者心情放松，语气友好，可能多聊一两句个人感受。】",
    "open": "【当前: 患者对护士建立了信任，愿意详细描述病情和感受，可能主动透露额外信息。】",
}

TRANSITIONS = {
    ("neutral", "关心/共情"): 1,
    ("neutral", "粗鲁/指责"): -1,
    ("neutral", "追问隐私"): -1,
    ("relaxed", "粗鲁/指责"): -2,
    ("relaxed", "追问隐私"): -1,
    ("relaxed", "关心/共情"): 1,
    ("defensive", "道歉/安抚"): 1,
    ("defensive", "关心/共情"): 1,
    ("defensive", "追问隐私"): -1,
    ("defensive", "粗鲁/指责"): -1,
    ("withdrawn", "道歉/安抚"): 1,
    ("withdrawn", "关心/共情"): 1,
    ("open", "粗鲁/指责"): -2,
}

_INTENT_KEYWORDS = {
    "关心/共情": ["别担心", "没关系", "慢慢说", "理解", "辛苦", "不容易", "放心", "会好的", "别着急"],
    "道歉/安抚": ["抱歉", "对不起", "不好意思", "不是故意", "打扰"],
    "解释原因": ["因为", "原因是", "为了评估", "需要了解", "方便", "以便", "这样才能"],
    "粗鲁/指责": ["必须", "快点", "你怎么", "认真点", "赶紧", "别废话"],
    "追问隐私": ["抽烟", "喝酒", "工资", "结婚", "家庭", "经济"],
}


def classify_intent(msg: str) -> str:
    """对学生消息做意图分类（纯规则匹配，不调 LLM）。"""
    if not msg:
        return "普通提问"
    msg_lower = msg.lower()
    for intent, keywords in _INTENT_KEYWORDS.items():
        if any(kw in msg_lower for kw in keywords):
            return intent
    return "普通提问"


class EmotionState:
    """单次会话的情绪状态跟踪器，score 范围 [-2, 2]"""

    def __init__(self):
        self.score = 0
        self.history: list[dict] = []

    @property
    def state(self) -> str:
        return EMOTION_LEVELS[self.score][0]

    @property
    def note(self) -> str:
        return STATE_NOTES.get(self.state, STATE_NOTES["neutral"])

    def update(self, intent: str):
        key = (self.state, intent)
        delta = TRANSITIONS.get(key, 0)
        if delta != 0:
            old_score = self.score
            self.score = max(-2, min(2, self.score + delta))
            self.history.append({
                "score": self.score,
                "state": self.state,
                "intent": intent,
                "timestamp": datetime.now(UTC).isoformat(),
            })
            if self.score != old_score:
                old_state = EMOTION_LEVELS[old_score][0]
                new_state = EMOTION_LEVELS[self.score][0]
                log.debug("情绪变化: %s(%+d) → %s(%+d) [意图: %s]", old_state, old_score, new_state, self.score, intent)
        else:
            # 普通提问轻微回中
            if self.score < 0:
                self.score = min(0, self.score + 1)
            elif self.score > 0:
                self.score = max(0, self.score - 1)


# Per-recording emotion state cache
_emotion_cache: dict[int, EmotionState] = {}


def get_emotion(record_id: int) -> EmotionState:
    if record_id not in _emotion_cache:
        _emotion_cache[record_id] = EmotionState()
    return _emotion_cache[record_id]


def cleanup_emotion(record_id: int):
    _emotion_cache.pop(record_id, None)


def get_emotion_v2(record_id: int, cache: EmotionCache) -> CacheEmotionState:
    """Get or create emotion state using a cache instance."""
    return cache.get(record_id)


def cleanup_emotion_v2(record_id: int, cache: EmotionCache) -> None:
    """Clean up emotion state using a cache instance."""
    cache.cleanup(record_id)
