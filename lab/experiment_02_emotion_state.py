#!/usr/bin/env python3
"""实验 2: 患者情绪状态机

5 态模型：neutral → relaxed → hesitant → defensive → withdrawn
通过 CLI 模拟对话，每轮学生输入后患者状态自动更新。

用法:
    python experiment_02_emotion_state.py
"""

EMOTION_LEVELS = {
    -2: ("withdrawn", "沉默、敷衍。回答极其简短，回避眼神接触。"),
    -1: ("defensive", "防御、不耐烦。回答带抵触情绪，需要安抚。"),
    0: ("neutral", "正常配合。按病例信息回答，不主动不抗拒。"),
    1: ("relaxed", "放松、配合。可能主动透露额外信息，语气友好。"),
    2: ("open", "开放、信任。愿意详细描述感受，主动提问。"),
}

STATE_PROMPTS = {
    "withdrawn": "【情绪: withdrawn】患者现在沉默寡言，极度回避。回答不超过5个字或用'嗯'敷衍。只有在学生真诚道歉或表达深切关心时才可能缓和。",
    "defensive": "【情绪: defensive】患者现在有防御情绪，回答简短且带抵触。如果学生继续追问隐私而不解释原因，可能恶化。需要学生先安抚。",
    "neutral": "【情绪: neutral】患者正常配合，按病例信息如实回答。不主动不抗拒。",
    "relaxed": "【情绪: relaxed】患者心情放松，语气友好。可能在回答完问题后会多聊一两句，透露额外的个人感受。",
    "open": "【情绪: open】患者对护士建立了信任，愿意详细描述病情和个人感受。可能主动说'其实我还有个事想跟你说...'。",
}

TRANSITIONS = {
    # (current, trigger) -> delta
    ("neutral", "关心/共情"): 1,
    ("neutral", "粗鲁/指责"): -1,
    ("neutral", "追问隐私"): -1,
    ("neutral", "解释原因"): 0,
    ("relaxed", "粗鲁/指责"): -2,
    ("relaxed", "追问隐私"): -1,
    ("relaxed", "关心/共情"): 1,
    ("defensive", "道歉/安抚"): 1,
    ("defensive", "关心/共情"): 1,
    ("defensive", "追问隐私"): -1,
    ("defensive", "粗鲁/指责"): -1,
    ("withdrawn", "道歉/安抚"): 1,
    ("withdrawn", "关心/共情"): 1,
    ("hesitant", "解释原因"): 1,
    ("hesitant", "追问隐私"): -1,
    ("hesitant", "关心/共情"): 1,
    ("open", "粗鲁/指责"): -2,
    ("open", "关心/共情"): 0,
}


def classify_intent(msg: str) -> str:
    msg_lower = msg.lower()
    # 关心/共情
    if any(w in msg_lower for w in ["别担心", "没关系", "慢慢说", "理解", "辛苦", "不容易"]):
        return "关心/共情"
    # 道歉/安抚
    if any(w in msg_lower for w in ["抱歉", "对不起", "不好意思", "不是故意的"]):
        return "道歉/安抚"
    # 解释原因
    if any(w in msg_lower for w in ["因为", "原因是", "为了评估", "需要了解", "方便"]):
        return "解释原因"
    # 粗鲁/指责
    if any(w in msg_lower for w in ["必须", "快点", "你怎么", "认真点"]):
        return "粗鲁/指责"
    # 追问隐私（不含解释）
    if any(w in msg_lower for w in ["抽烟", "喝酒", "工资", "结婚", "家庭矛盾", "经济"]):
        return "追问隐私"
    return "普通提问"


class EmotionState:
    def __init__(self):
        self.score = 0  # -2 to 2

    @property
    def state(self) -> str:
        return EMOTION_LEVELS[self.score][0]

    @property
    def description(self) -> str:
        return EMOTION_LEVELS[self.score][1]

    @property
    def prompt(self) -> str:
        return STATE_PROMPTS[self.state]

    def update(self, intent: str):
        key = (self.state, intent)
        delta = TRANSITIONS.get(key, 0)
        self.score = max(-2, min(2, self.score + delta))

    def display(self):
        bar = "█" * (self.score + 2) + "░" * (4 - (self.score + 2))
        print(f"\n  情绪: [{bar}] {self.state} ({self.score:+d})")
        print(f"  表现: {self.description}")


def main():
    print("=" * 60)
    print("  患者情绪状态机模拟")
    print("  触发词：关心/共情 | 道歉/安抚 | 解释原因 | 粗鲁/指责 | 追问隐私")
    print("  输入 'q' 退出")
    print("=" * 60)

    emo = EmotionState()
    print(f"\n初始状态: {emo.state}")

    while True:
        msg = input("\n学生: ").strip()
        if msg.lower() == "q":
            break
        if not msg:
            continue

        intent = classify_intent(msg)
        print(f"  识别意图: {intent}")

        before = emo.score
        emo.update(intent)
        if emo.score != before:
            print(f"  状态变更: {EMOTION_LEVELS[before][0]} → {EMOTION_LEVELS[emo.score][0]}")
        emo.display()

        print(f"\n  [下一轮患者 prompt 将注入:]")
        print(f"  {emo.prompt}")


if __name__ == "__main__":
    main()
