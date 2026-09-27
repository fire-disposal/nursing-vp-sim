#!/usr/bin/env python3
"""U0 研究配置：把 SUS 十题 + 三个开放题配成 `after_scoring` 问卷模板并绑定病例。

为什么是脚本而不是手点管理台：U0 的候选冻结要求**可复跑、可审计**。本脚本幂等
（按标题找模板，存在即复用），并把「题目内容指纹」算出来打印——服务端只把该指纹写进
审计载荷（`questions_digest`），接口不暴露，候选清单需要它来钉住"用的哪一版问卷"。

用法：

    # 本地验证栈（默认）
    uv run python scripts/u0-configure-sus.py --username u0b_teacher --password u0b-verify-pass

    # 生产（冻结时执行；凭据用真实教师/管理员账号）
    uv run python scripts/u0-configure-sus.py --api-base https://iomt.205716.xyz/api \
        --username <teacher> --password <password> --case-name 咳嗽咳痰伴呼吸困难

    # 只预览不改动
    uv run python scripts/u0-configure-sus.py --dry-run ...

设计约定（与 docs/19 §三 一致）：

* **极性由位置决定**：SUS 奇数题正向、偶数题负向。题目模型没有反向标记，应用内只算 likert
  均值；标准总分由分析脚本按位置计算（奇：分-1；偶：5-分；求和 ×2.5）。因此**题目顺序不得调整**，
  调整即等于换量表 —— 指纹会变，候选清单据此可发现。
* 题干用通行中文 SUS 译法；**最终措辞由研究者定稿**（`--title` 与题目文本集中在下面的常量里）。
* 三个开放题对应 docs/19 §3.3 的三问；`short_text` 为选填（不强制），避免卡住参与者。
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

TEMPLATE_TITLE = "系统可用性量表（SUS）+ 开放题 · U0"

#: SUS 十题：**顺序即极性**（奇数正向、偶数负向）。措辞待研究者定稿，勿随意改顺序。
SUS_ITEMS: tuple[str, ...] = (
    "1. 我想我会经常使用这个训练系统。",
    "2. 我觉得这个系统没有必要地复杂。",
    "3. 我觉得这个系统很容易使用。",
    "4. 我觉得需要技术人员帮助才能使用这个系统。",
    "5. 我觉得这个系统的各项功能整合得很好。",
    "6. 我觉得这个系统太不一致了。",
    "7. 我想大多数人会很快学会使用这个系统。",
    "8. 我觉得这个系统用起来很别扭。",
    "9. 我对这个系统很有信心。",
    "10. 我需要学习很多东西才能开始使用这个系统。",
)

OPEN_ITEMS: tuple[str, ...] = (
    "最不顺的步骤：哪一步你花了最多时间或最不确定该做什么？",
    "反馈评价：哪些反馈最有用？哪些让你觉得不可信？",
    "真实性：哪一处最不像真实的临床情境？",
)

QUESTION_TYPE_LIKERT = "likert_5"
QUESTION_TYPE_TEXT = "short_text"


def request(
    api_base: str,
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict | None = None,
) -> object:
    url = f"{api_base}{path}"
    data = (
        json.dumps(body, ensure_ascii=False).encode("utf-8")
        if body is not None
        else None
    )
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)  # noqa: S310 — 地址由操作者显式给出
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise SystemExit(f"{method} {path} → HTTP {exc.code}: {detail}") from exc


def _server_questions_digest():
    """服务端的题目指纹函数（**唯一实现**，审计载荷用的就是它）。

    脚本不再自己写一份等价算法：两份哈希迟早会因为字段增减而说不到一起，而"候选用的哪一版问卷"
    正是靠这个值对齐的。后端不在 sys.path 时直接报错，不静默退回本地实现。
    """
    backend_dir = Path(__file__).resolve().parent.parent / "backend"
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    from modules.questionnaires.service import _questions_digest  # noqa: PLC0415 — 脚本按需引入，避免 import 期就依赖后端环境

    return _questions_digest


def build_questions() -> list[dict]:
    #: likert_5 的选项是**字符串列表**（服务端 schema 如此；分值由位置决定：第 n 项 = n 分）
    likert_options = ["非常不同意", "不同意", "中立", "同意", "非常同意"]
    items: list[dict] = []
    for index, content in enumerate(SUS_ITEMS, start=1):
        items.append(
            {
                "content": content,
                "question_type": QUESTION_TYPE_LIKERT,
                "required": True,
                "sort_order": index,
                "options": list(likert_options),
            }
        )
    for offset, content in enumerate(OPEN_ITEMS, start=1):
        items.append(
            {
                "content": content,
                "question_type": QUESTION_TYPE_TEXT,
                "required": False,
                "sort_order": len(SUS_ITEMS) + offset,
                "options": None,
            }
        )
    return items


def find_template(api_base: str, token: str, title: str) -> dict | None:
    """按标题在模板列表里找（幂等前提）。"""
    listing = request(api_base, "GET", "/questionnaires/templates", token=token)
    rows = listing.get("items") if isinstance(listing, dict) else listing
    for row in rows or []:
        if isinstance(row, dict) and str(row.get("title", "")).strip() == title:
            return row
    return None


def resolve_case_id(api_base: str, token: str, case_name: str) -> int:
    listing = request(api_base, "GET", "/cases?offset=0&limit=200", token=token)
    rows = listing.get("items") if isinstance(listing, dict) else listing
    for row in rows or []:
        if isinstance(row, dict) and str(row.get("name", "")).strip() == case_name:
            return int(row["id"])
    raise SystemExit(f"病例不存在：{case_name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="配置 U0 的 SUS 问卷模板并绑定病例")
    parser.add_argument("--api-base", default="http://127.0.0.1:8000/api")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--title", default=TEMPLATE_TITLE)
    parser.add_argument(
        "--case-name", action="append", default=[], help="要绑定的病例名（可重复）"
    )
    parser.add_argument("--trigger", default="after_scoring")
    parser.add_argument("--required", action="store_true", help="把问卷设为必答")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.case_name:
        args.case_name = ["咳嗽咳痰伴呼吸困难"]

    questions = build_questions()
    digest_fn = _server_questions_digest()
    digest = digest_fn(questions)
    print(
        f"题目：{len(questions)} 条（SUS {len(SUS_ITEMS)} + 开放 {len(OPEN_ITEMS)}），指纹 questions@{digest}"
    )

    login = request(
        args.api_base,
        "POST",
        "/auth/login",
        body={"username": args.username, "password": args.password},
    )
    token = login.get("access_token") or login.get("token")
    if not token:
        raise SystemExit("登录未返回 token")

    existing = find_template(args.api_base, token, args.title)
    if existing:
        print(
            f"模板已存在：id={existing.get('id')} title={existing.get('title')!r}（复用，不覆盖题目）"
        )
        template_id = int(existing["id"])
    elif args.dry_run:
        print("[dry-run] 将创建模板：", args.title)
        template_id = -1
    else:
        created = request(
            args.api_base,
            "POST",
            "/questionnaires/templates",
            token=token,
            body={
                "title": args.title,
                "type": "usability",
                "description": "U0 系统可用性评价：SUS 十题（奇数正向/偶数负向）+ 三个开放题",
                "is_active": True,
                "questions": questions,
            },
        )
        template_id = int(created["id"])
        print(f"已创建模板：id={template_id}")

    case_ids = [resolve_case_id(args.api_base, token, name) for name in args.case_name]
    print(
        f"绑定：cases={list(zip(args.case_name, case_ids, strict=True))} trigger={args.trigger} required={args.required}"
    )
    if args.dry_run:
        print("[dry-run] 未写入绑定")
        return

    request(
        args.api_base,
        "PUT",
        f"/questionnaires/templates/{template_id}/case-assignments",
        token=token,
        body={
            "case_ids": case_ids,
            "is_required": bool(args.required),
            "trigger_event": args.trigger,
        },
    )

    detail = request(
        args.api_base, "GET", f"/questionnaires/templates/{template_id}", token=token
    )
    server_questions = detail.get("questions") or []
    server_digest = digest_fn(
        [
            {
                "content": q.get("content"),
                "question_type": q.get("question_type"),
                "required": q.get("required"),
                "sort_order": q.get("sort_order"),
                "options": q.get("options"),
            }
            for q in server_questions
        ]
    )
    same = server_digest == digest
    print(
        "完成：",
        json.dumps(
            {
                "template_id": template_id,
                "title": detail.get("title"),
                "questions": len(server_questions),
                "digest_local_definition": f"questions@{digest}",
                "digest_server_stored": f"questions@{server_digest}",
                "digest_match": same,
                "case_ids": detail.get("case_ids"),
                "updated_at": detail.get("updated_at"),
            },
            ensure_ascii=False,
        ),
    )
    if not same:
        print(
            "警告：服务端题目与本地定义指纹不一致 —— 库里的问卷不是本脚本定义的那一份，"
            "候选清单不得据此声明问卷身份。",
            file=sys.stderr,
        )
        raise SystemExit(2)


if __name__ == "__main__":
    sys.exit(main())
