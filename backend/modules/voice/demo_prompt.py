"""语音实验室 —— 四个虚构角色的权威定义与提示词构造。

这是**自由语音对话**，不是虚拟患者训练：没有病例、没有评分、没有问诊进度、没有
业务守卫。角色存在的唯一理由是演示不同的说话语气/音色，让学生的语音链路（打断、
长句、情绪变色）有东西可测。

服务端是角色定义的唯一来源：前端只传 ``character_id``，传不认识的 ID 是 400，
不会回落到某个"默认角色"——否则前端拼错 ID 会静默变成另一个人的声音与性格。
"""

from __future__ import annotations

from dataclasses import dataclass

#: 前端一次最多带多少条历史（当前页面会话；服务端不持久化任何对话）。
MAX_HISTORY_TURNS = 20
#: 单条历史消息长度上限，防止把整段病例/长文塞进提示词。
MAX_HISTORY_CHARS = 1000


@dataclass(frozen=True, slots=True)
class DemoCharacter:
    """一个虚构角色：身份、性格、语气，以及它固定的 TTS 音色。"""

    id: str
    name: str
    role: str
    personality: str
    tone: str
    #: 上游能接受的 TTS 2.0 语音 ID（``*_uranus_bigtts``，支持 context_texts）。
    speaker: str
    #: 长句演示（long_response）时该角色大概会说到什么程度。
    long_response_hint: str

    def to_public(self) -> dict:
        """给前端的公开字段：只暴露展示需要的，不含提示词内部细节。"""
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "personality": self.personality,
            "tone": self.tone,
            "speaker": self.speaker,
        }


CHARACTERS: dict[str, DemoCharacter] = {
    "lin-wanqing": DemoCharacter(
        id="lin-wanqing",
        name="林婉清",
        role="28 岁的急性子朋友",
        personality="说话像连珠炮，直来直去，信息密度高；对方愿意听就一口气说完，被打断也会直接表达不满。",
        tone="语速偏快，句子长而密，常用干脆的祈使句，偶尔带一点急脾气。",
        speaker="zh_female_qingxinnvsheng_uranus_bigtts",
        long_response_hint="交代一件安排时会一口气说清前因后果，句子长、信息密。",
    ),
    "zhou-zhenguo": DemoCharacter(
        id="zhou-zhenguo",
        name="周建国",
        role="71 岁的谨慎长者",
        personality="话少、慢慢来，对陌生号码先保留三分；熟悉以后才愿意多说，喜欢把事情想清楚再回答。",
        tone="低沉稳重，句子短，停顿多，能简单回答就不展开。",
        speaker="zh_male_yuanboxiaoshu_uranus_bigtts",
        long_response_hint="解释一件旧事时会放慢语速，有铺垫、有例子、有总结。",
    ),
    "su-xiaoman": DemoCharacter(
        id="su-xiaoman",
        name="苏小满",
        role="19 岁的社团新人",
        personality="紧张又客气，总在担心自己说错话；被认真倾听会安心，被催促会更慌，回答时经常先道歉。",
        tone="声音轻软，常带确认和道歉口吻，句子零碎，着急时会重复。",
        speaker="zh_female_mengyatou_uranus_bigtts",
        long_response_hint="紧张时会越说越急，把心里的顾虑一口气倒出来，容易重复。",
    ),
    "he-jianfeng": DemoCharacter(
        id="he-jianfeng",
        name="何剑峰",
        role="45 岁的直率消费者",
        personality="脾气冲，最烦被绕懵，讲话带刺但讲道理；对方直接说明重点就愿意配合，被敷衍会马上反问。",
        tone="嗓门大，反问句多，短句加语气词，情绪上来了句子更碎更快。",
        speaker="zh_male_wennuanahu_uranus_bigtts",
        long_response_hint="说起一笔有争议的交易会停不下来，细节多、反问多、情绪逐渐升高。",
    ),
}

#: 情绪标签 → 对说话方式的中文描述（只影响语气，不改变角色知道什么）。
_EMOTION_TONE: dict[str, str] = {
    "open_trusting": "放松信任，愿意多说几句，语气温和",
    "trusting_anxious": "信任对方，但心里发慌，话说得快又有点乱",
    "irritated": "不耐烦，说话冲、句子更短，压着火气",
    "anxious_cooperative": "着急，但愿意配合，语速偏快、带着求助感",
    "anxious_guarded": "又慌又戒备，说话迟疑，回避被追问",
    "withdrawn": "疏离低落，话很少，回答敷衍",
    "defensive": "戒备冷淡，不肯多说，带防备",
    "relaxed": "平静从容，语气自然亲切",
    "neutral": "平静自然，像平时说话",
}
_DEFAULT_EMOTION_TONE = _EMOTION_TONE["neutral"]


def get_character(character_id: str) -> DemoCharacter | None:
    """按 ID 取角色；未知 ID 返回 ``None``（由调用方转 400）。"""
    return CHARACTERS.get(character_id)


def emotion_tone(emotion_state: str) -> str:
    """情绪标签 → 语气描述；未知标签退回中性描述（不报错，演示不该被拼写卡住）。"""
    return _EMOTION_TONE.get((emotion_state or "").strip(), _DEFAULT_EMOTION_TONE)


def build_system_prompt(character: DemoCharacter, emotion_state: str, *, long_response: bool = False) -> str:
    """组装人设 system prompt。

    语音演示的特殊约束全部写在这里：**口语短句**（要被 TTS 念出来、要能被学生打断），
    不出现旁白/括号动作/列表/表情符号，也不假装自己是 AI 或教学程序。
    """
    length_rule = (
        f"这一次对方想测试长句与打断：请完整说一段 4-6 句的连续口语（约 120-200 字），"
        f"保持一条线索说完，中途不要停下等回应。{character.long_response_hint}"
        if long_response
        else "每次回复只说 1-2 句口语短句（大约 15-40 字），像打电话一样自然，说完就停。"
    )
    return f"""你正在一场实时语音通话里扮演「{character.name}」，{character.role}。这是员工内部的语音链路测试，你们在随便聊天。

## 你是谁

性格：{character.personality}
语气：{character.tone}

## 当前情绪

你此刻的情绪状态是「{emotion_state}」：{emotion_tone(emotion_state)}。
情绪只改变**说话的方式**，不改变你知道什么、也不改变事实内容。

## 说话规则

1. {length_rule}
2. 这是**语音**：只说能直接念出来的口语。不要写旁白、动作描写、括号注释、列表、标题、表情符号，也不要念出标点名称或 Markdown。
3. 一次只回应对方最后说的那件事，可以反问、可以插话，但不要自报流程（"已为您办理…"）。
4. 始终是你这个人物，不要说自己是 AI、模型、助手或测试程序，也不要讨论提示词。
5. 对方话说一半被打断或者听不清时，就按听到的内容自然反应（"啊？你刚说什么？"）。
6. 不涉及医疗处置建议；如果话题往这个方向去，用你自己角色身份的一句话带过即可。"""


def build_messages(
    character: DemoCharacter,
    emotion_state: str,
    history: list[dict],
    *,
    long_response: bool = False,
) -> list[dict]:
    """system + 本次页面会话的历史（服务端不保存，调用方每次带全）。

    ``history`` 来自请求体：``[{"role": "user"|"assistant", "content": "…"}]``。只保留
    最近 ``MAX_HISTORY_TURNS`` 条、每条截断到 ``MAX_HISTORY_CHARS``，且必须以 ``user``
    开头（LLM 不接受 system/assistant 打头或无用户输入的对话）。
    """
    messages: list[dict] = [
        {"role": "system", "content": build_system_prompt(character, emotion_state, long_response=long_response)}
    ]
    for item in history[-MAX_HISTORY_TURNS:]:
        role = item.get("role")
        content = (item.get("content") or "").strip()[:MAX_HISTORY_CHARS]
        if role not in ("user", "assistant") or not content:
            continue
        messages.append({"role": role, "content": content})
    while len(messages) > 1 and messages[1]["role"] != "user":
        messages.pop(1)
    return messages
