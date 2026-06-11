#!/usr/bin/env python3
"""Diagnosis script — collects logs, commits, and calls DeepSeek for root cause analysis.

Usage:
  python3 scripts/diagnose.py --symptom "5xx spike" --service prod \
    --log-file /tmp/container.log --commits-file /tmp/recent_commits.txt \
    --output /tmp/diagnosis.md
"""

import argparse
import json
import os
import sys
from pathlib import Path

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


def _call_llm(system_prompt: str, user_prompt: str) -> str:
    if not DEEPSEEK_API_KEY:
        return "**LLM 不可用** — 请设置 DEEPSEEK_API_KEY 环境变量\n\n以下是原始诊断数据："

    import http.client
    data = json.dumps({
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 2048,
    })

    conn = http.client.HTTPSConnection("api.deepseek.com", timeout=30)
    conn.request("POST", "/v1/chat/completions", body=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    })
    resp = conn.getresponse()
    body = json.loads(resp.read())

    if "choices" not in body:
        return f"**LLM 调用失败** — {body.get('error', {}).get('message', str(body))}"

    return body["choices"][0]["message"]["content"]


SYSTEM_PROMPT = """你是一名资深的运维排障工程师，专门分析 Nursing VP Sim（护理虚拟病人模拟器）的生产环境问题。

你的任务：
1. 分析提供给您的容器日志、git 提交记录和症状描述
2. 找出最可能的根因（Root Cause），包括确切的文件路径和行号（如果能推断出来）
3. 给出修复建议（具体的代码 diff 或配置变更，如果可行）
4. 标注置信度（高/中/低）并说明为什么

输出格式（Markdown）：

## 诊断报告

**根因**：[一句话描述]
**影响范围**：[受影响的用户/功能]
**置信度**：[高/中/低] — [原因]

### 证据

- [相关日志行]
- [相关提交]
- [症状关联]

### 修复建议

[具体修复方案，尽可能提供代码 diff]

### 预防措施

[如何避免同类问题]
"""


def diagnose(symptom: str, service: str, log_file: str, commits_file: str, state_snippet: str = "") -> str:
    try:
        logs = Path(log_file).read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        logs = "(无法读取日志文件)"
    try:
        commits = Path(commits_file).read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        commits = "(无法读取提交记录)"

    # Truncate logs to avoid exceeding token limits
    max_log_chars = 12000
    if len(logs) > max_log_chars:
        logs = logs[-max_log_chars:]
        logs = f"(日志已截断，仅显示最后 {max_log_chars} 字符)\n\n{logs}"

    user_prompt = f"""## 环境
- 服务: {service}
- 症状: {symptom}
{f"- 监控状态: {state_snippet}" if state_snippet else ""}

## 容器日志 (docker logs --since)
```
{logs}
```

## 近期提交 (git log --oneline -20)
```
{commits}
```
"""
    return _call_llm(SYSTEM_PROMPT, user_prompt)


def main():
    parser = argparse.ArgumentParser(description="Nursing VP Sim auto-diagnosis")
    parser.add_argument("--symptom", required=True, help="Observed symptom")
    parser.add_argument("--service", default="prod", help="Affected service (prod/staging)")
    parser.add_argument("--log-file", required=True, help="Path to container log file")
    parser.add_argument("--commits-file", required=True, help="Path to git log file")
    parser.add_argument("--state-snippet", default="", help="Relevant state.json snippet")
    parser.add_argument("--output", default="-", help="Output file path (- for stdout)")
    args = parser.parse_args()

    result = diagnose(args.symptom, args.service, args.log_file, args.commits_file, args.state_snippet)

    if args.output == "-":
        print(result)
    else:
        Path(args.output).write_text(result, encoding="utf-8")
        print(f"Diagnosis written to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
