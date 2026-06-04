#!/usr/bin/env python3
"""实验 4: 时间循环 — 非回合制对话（远期目标）

概念验证: 患者在学生沉默时主动发言，打破回合制。

当前实现: 使用 asyncio 超时机制，如果学生在 N 秒内未发言，
患者主动推送消息。

实际项目中的应用需要 WebSocket/SSE 双向流，当前仅为概念验证。
"""

import asyncio
import random

PATIENT_PROACTIVE = [
    "你还有什么想问的吗？",
    "对了，我最近睡觉也不太好，你要不要问问？",
    "你是不是还想知道我之前吃的什么药？",
    "要不今天就到这吧……我有点累了。",
]


async def patient_loop(queue: asyncio.Queue):
    """患者在沉默超时后主动发言"""
    while True:
        try:
            msg = await asyncio.wait_for(queue.get(), timeout=5.0)
            print(f"\n学生: {msg}")
        except asyncio.TimeoutError:
            proactive = random.choice(PATIENT_PROACTIVE)
            print(f"\n[患者主动]: {proactive}")
        except asyncio.CancelledError:
            break


async def main():
    print("=" * 60)
    print("  时间循环概念验证")
    print("  5 秒内不输入，患者会主动发言")
    print("  输入 'q' 退出")
    print("=" * 60)

    queue: asyncio.Queue = asyncio.Queue()
    task = asyncio.create_task(patient_loop(queue))

    await asyncio.sleep(0.5)
    print("\n[患者]: 你好，护士。我今天不太舒服，所以来看看。")

    try:
        while True:
            msg = await asyncio.to_thread(input, "\n你: ")
            if msg.strip().lower() == "q":
                break
            await queue.put(msg.strip())
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


if __name__ == "__main__":
    asyncio.run(main())
