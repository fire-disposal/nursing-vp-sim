"""LLM prompt fragment instructing emotion-structured output."""

EMOTION_OUTPUT_INSTRUCTION = """
【情感输出规则】
在回复末尾，你必须附加一个单独的 JSON 块（不要包含在患者话语中）：
{"emotion":{"trust_delta":-3到3的整数,"comfort_delta":-3到3的整数,"trigger":"破冰/共鸣/刺伤/无"}}

- trust_delta: 你对护士专业能力的信任变化。-3=严重削弱信任，+3=显著增强信任，0=无变化。
- comfort_delta: 你的舒适/放松程度变化。-3=很不舒服，+3=明显放松，0=无变化。
- trigger: 特殊事件标记。
  * "破冰"=护士首次表达真诚共情或使用你喜欢的称呼
  * "共鸣"=你主动透露了护士未直接问及的私密信息
  * "刺伤"=护士使用恐惧性语言或明显忽视你的主诉
  * "无"=本轮无特殊事件

格式要求：JSON 块独立一行，不要嵌套在引号或 Markdown 中。
示例回复末尾：
我觉得最近好多了。
{"emotion":{"trust_delta":2,"comfort_delta":1,"trigger":"无"}}
"""
