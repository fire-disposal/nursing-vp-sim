#!/usr/bin/env python3
"""实验 3: 实时对话提示

检测学生消息中是否涉及护理关键点，实时展示"已采集/未采集"状态。
纯规则匹配（关键词映射），不需要额外的 LLM 调用。

用法:
    python experiment_03_realtime_hints.py
    输入学生消息，查看实时提示更新
"""

import re
from collections import OrderedDict

SAMPLE_CASE = {
    "required_inquiries": [
        "血压值", "吸烟史", "饮酒情况", "过敏史", "用药依从性",
        "睡眠质量", "心理状态", "饮食习惯", "运动习惯", "家族史",
        "职业暴露", "经济状况",
    ],
    "keyword_map": {
        "血压值": ["血压", "高压", "低压"],
        "吸烟史": ["抽烟", "吸烟", "烟", "戒烟"],
        "饮酒情况": ["喝酒", "饮酒", "酒量", "酗酒"],
        "过敏史": ["过敏", "青霉素", "头孢"],
        "用药依从性": ["按时吃药", "忘了吃药", "停药", "坚持服药"],
        "睡眠质量": ["睡觉", "失眠", "入睡", "熬夜", "睡眠"],
        "心理状态": ["焦虑", "紧张", "压力", "心情", "担心"],
        "饮食习惯": ["吃饭", "饮食", "口味", "吃素"],
        "运动习惯": ["运动", "锻炼", "散步", "跑步"],
        "家族史": ["家族", "父母", "遗传", "家里人"],
        "职业暴露": ["工作环境", "粉尘", "化学品", "久坐"],
        "经济状况": ["费用", "医保", "贵", "负担"],
    },
}

HINT_STATUS = OrderedDict()


def reset_hints():
    HINT_STATUS.clear()
    for item in SAMPLE_CASE["required_inquiries"]:
        HINT_STATUS[item] = False


def check_hints(msg: str) -> list[str]:
    newly_covered = []
    for item, keywords in SAMPLE_CASE["keyword_map"].items():
        if not HINT_STATUS[item]:
            for kw in keywords:
                if kw in msg:
                    HINT_STATUS[item] = True
                    newly_covered.append(item)
                    break
    return newly_covered


def display_hints():
    collected = sum(1 for v in HINT_STATUS.values() if v)
    total = len(HINT_STATUS)

    print(f"\n{'─' * 50}")
    print(f"  护理关键点: {collected}/{total}")
    print(f"  [{'▓' * collected}{'░' * (total - collected)}]")
    print()

    for item, done in HINT_STATUS.items():
        icon = "✓" if done else "○"
        color = "\033[32m" if done else "\033[90m"
        reset = "\033[0m"
        print(f"  {color}{icon} {item}{reset}")
    print(f"{'─' * 50}")


def main():
    print("=" * 60)
    print("  实时对话提示模拟")
    print("  输入学生消息，观察关键点覆盖变化")
    print("  输入 'r' 重置, 'q' 退出")
    print("=" * 60)

    reset_hints()
    display_hints()

    while True:
        msg = input("\n学生: ").strip()
        if msg.lower() == "q":
            break
        if msg.lower() == "r":
            reset_hints()
            print("  已重置")
            display_hints()
            continue
        if not msg:
            continue

        new = check_hints(msg)
        for item in new:
            print(f"  ✦ 新覆盖: {item}")

        display_hints()


if __name__ == "__main__":
    main()
