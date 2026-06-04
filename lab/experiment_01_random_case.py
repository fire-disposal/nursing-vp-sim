#!/usr/bin/env python3
"""实验 1: 随机病例生成

LLM 实时生成唯一虚拟患者病例，包含完整人生背景和护理关键点。

用法:
    python experiment_01_random_case.py
    python experiment_01_random_case.py --save  # 保存到 cases/ 目录
"""

import json
import os
import sys
from datetime import datetime

import httpx
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

if not API_KEY:
    print("请在 .env 中设置 DEEPSEEK_API_KEY")
    sys.exit(1)

SYSTEM_PROMPT = """你是一名护理教育案例生成专家。请根据以下要求生成一份虚拟患者病例，用于护理学生进行病史采集训练（问诊练习）。

## 生成要求

1. **人物背景**: 生成完整个人资料，包括姓名（中文）、性别、年龄（成人18-85岁）、职业、教育程度、家庭结构、经济状况、性格特点、生活习惯（吸烟/饮酒/运动/饮食）。

2. **医学信息**: 
   - 主诉（chief_complaint）：1-2句话，患者来就诊的主要原因
   - 现病史（present_illness）：详细描述当前病情发展过程（发病时间、症状演变、曾用药物、对日常生活的影响）
   - 既往史（past_history）：过去相关疾病史
   - 用药史（medication_history）：当前和既往用药
   - 过敏史（allergy_history）：药物/食物过敏
   - 家族史（family_history）：直系亲属相关疾病
   - 心理社会史（social_history）：情绪状态、睡眠、食欲、社会支持等

3. **护理关键点**（required_inquiries）: 列出该病例必须采集的 8-15 个护理评估关键点，如：
   - 血压值、血糖值、用药依从性、过敏史确认、吸烟饮酒量、睡眠质量、心理状态等

4. **隐藏信息**（hidden_info_rules）: 2-4 个敏感/隐藏信息点，需要学生追问才透露。每个包含：
   - topic：主题名
   - info：具体信息内容
   - triggers：触发关键词列表（学生消息中包含任一即触发）
   - reveal_style：透露方式（"直说" | "犹豫后说" | "先回避再承认"）

5. **沟通风格**（communication_style）: 描述患者如何说话，例如：
   - "退休工人，说话直来直去，文化程度不高但性格爽朗，偶尔抱怨年轻护士不耐心"
   - "年轻白领，说话温和有礼但略带焦虑，担心病情影响工作"

6. **开场语**（opening_line）: 患者见到护士时的第一句话

## 输出格式
必须输出严格 JSON，字段名使用英文:
{
  "name": "病例名（简短）",
  "patient_info": {"name": "姓名", "age": 年龄, "gender": "性别", "occupation": "职业"},
  "chief_complaint": "主诉",
  "present_illness": "现病史",
  "past_history": "既往史",
  "medication_history": "用药史",
  "allergy_history": "过敏史",
  "family_history": "家族史",
  "social_history": "心理社会史",
  "required_inquiries": ["关键点1", "关键点2", ...],
  "hidden_info_rules": [{"topic": "...", "info": "...", "triggers": [...], "reveal_style": "..."}],
  "communication_style": "风格描述",
  "opening_line": "第一句话",
  "difficulty": 1-3,
  "time_limit": 20
}

请确保：
- 医学信息互洽（年龄、主诉、用药史、既往史不矛盾）
- 护理关键点与病例相关，覆盖生理、心理、社会维度
- 隐藏信息有合理的触发条件（不要太容易也不可太隐晦）
"""


async def generate_case(client: httpx.AsyncClient) -> dict:
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "请随机生成一份全新、不重复的虚拟患者病例。"},
        ],
        "temperature": 0.9,
        "max_tokens": 4096,
    }

    resp = await client.post(
        f"{BASE_URL}/v1/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    text = data["choices"][0]["message"]["content"]

    start = text.find("{")
    end = text.rfind("}") + 1
    return json.loads(text[start:end])


def print_case(case: dict):
    print("=" * 60)
    print(f"病例: {case.get('name', '未命名')}")
    print(f"难度: {'⭐' * case.get('difficulty', 1)}")
    print("=" * 60)

    pi = case.get("patient_info", {})
    print(f"患者: {pi.get('name')}, {pi.get('gender')}, {pi.get('age')}岁, {pi.get('occupation')}")
    print(f"主诉: {case.get('chief_complaint')}")
    print()
    print("--- 沟通风格 ---")
    print(case.get("communication_style"))
    print()
    print("--- 开场语 ---")
    print(case.get("opening_line"))
    print()
    print(f"--- 护理关键点 ({len(case.get('required_inquiries', []))}个) ---")
    for i, item in enumerate(case.get("required_inquiries", []), 1):
        print(f"  {i}. {item}")
    print()
    print(f"--- 隐藏信息 ({len(case.get('hidden_info_rules', []))}个) ---")
    for h in case.get("hidden_info_rules", []):
        print(f"  [{h.get('topic')}] {h.get('info')}")
        print(f"   触发: {', '.join(h.get('triggers', []))}")
        print(f"   方式: {h.get('reveal_style')}")
    print()

    for field in ["present_illness", "past_history", "medication_history", "allergy_history", "family_history", "social_history"]:
        val = case.get(field)
        if val:
            print(f"--- {field} ---")
            print(val)
            print()


async def main():
    async with httpx.AsyncClient() as client:
        print("正在生成随机病例...")
        case = await generate_case(client)
        print_case(case)

        if "--save" in sys.argv:
            os.makedirs("cases", exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            path = f"cases/{ts}_{case.get('name', 'case')}.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(case, f, ensure_ascii=False, indent=2)
            print(f"已保存: {path}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
