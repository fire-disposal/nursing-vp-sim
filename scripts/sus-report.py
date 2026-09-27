#!/usr/bin/env python3
"""U0 主结局：从问卷导出计算 SUS 总分与逐题表现。

为什么在应用外算：题目模型没有反向标记，服务端 `stats` 只给每题 likert 均值。
SUS 的极性由**题目位置**决定（奇数正向、偶数负向），标准算法是

    每题得分 = 奇数题 (答值 - 1) / 偶数题 (5 - 答值)   → 各 0~4 分
    总分     = Σ(每题得分) × 2.5                      → 0~100

所以**题目顺序即量表**：顺序变了必须当作新量表（`scripts/u0-configure-sus.py` 打印的
`questions@<digest>` 就是用来钉住这一点的）。

输出：参与者数、SUS 均值/标准差/中位数/极值、惯用参考线（≥68）占比、逐题均值（最差在前，
便于写"哪一条最拉低可用性"）、三个开放题的原文汇总；可选把逐人分数写成 CSV 供统计软件使用。

用法：

    uv run python scripts/sus-report.py --username u0b_teacher --password u0b-verify-pass
    uv run python scripts/sus-report.py --api-base https://iomt.205716.xyz/api \
        --username <teacher> --password <password> --out u0-sus-scores.csv
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import statistics
import sys
import urllib.error
import urllib.request

SUS_ITEM_COUNT = 10
#: 惯用参考线：Brooke 原始研究里的 SUS 均值。**不是**校准过的能力阈值，只作描述性对照。
REFERENCE_LINE = 68.0


def request(
    api_base: str,
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict | None = None,
):
    data = (
        json.dumps(body, ensure_ascii=False).encode("utf-8")
        if body is not None
        else None
    )
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{api_base}{path}", data=data, headers=headers, method=method
    )  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise SystemExit(
            f"{method} {path} → HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}"
        ) from exc


def sus_score(values: list[int]) -> float:
    """标准 SUS 总分（0-100）。`values` 按题目顺序，长度必须是 10。"""
    if len(values) != SUS_ITEM_COUNT:
        raise ValueError(f"SUS 需要 {SUS_ITEM_COUNT} 个作答，收到 {len(values)}")
    total = 0
    for index, value in enumerate(values, start=1):
        total += (value - 1) if index % 2 == 1 else (5 - value)
    return total * 2.5


def main() -> None:
    parser = argparse.ArgumentParser(description="计算 U0 的 SUS 总分")
    parser.add_argument("--api-base", default="http://127.0.0.1:8000/api")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--template-id", type=int, default=None)
    parser.add_argument("--title", default="系统可用性量表（SUS）+ 开放题 · U0")
    parser.add_argument("--out", default=None, help="逐人分数 CSV 的输出路径")
    args = parser.parse_args()

    login = json.loads(
        request(
            args.api_base,
            "POST",
            "/auth/login",
            body={"username": args.username, "password": args.password},
        )
    )
    token = login.get("access_token") or login.get("token")
    if not token:
        raise SystemExit("登录未返回 token")

    template_id = args.template_id
    if template_id is None:
        listing = json.loads(
            request(args.api_base, "GET", "/questionnaires/templates", token=token)
        )
        rows = listing.get("items") if isinstance(listing, dict) else listing
        match = next(
            (r for r in rows or [] if str(r.get("title", "")).strip() == args.title),
            None,
        )
        if not match:
            raise SystemExit(f"找不到模板：{args.title}")
        template_id = int(match["id"])

    detail = json.loads(
        request(
            args.api_base,
            "GET",
            f"/questionnaires/templates/{template_id}",
            token=token,
        )
    )
    questions = detail.get("questions") or []
    likert = [
        q for q in questions if q.get("question_type") in {"likert_5", "satisfaction_5"}
    ]
    open_items = [q for q in questions if q not in likert]
    if len(likert) != SUS_ITEM_COUNT:
        raise SystemExit(
            f"该模板有 {len(likert)} 道量表题，SUS 需要 {SUS_ITEM_COUNT} 道（顺序即极性）"
        )

    raw = request(
        args.api_base,
        "POST",
        f"/questionnaires/responses/{template_id}/export",
        token=token,
    )
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    if not rows:
        print(
            "没有作答（导出为空）。模板 id=%s，题目 %d 道"
            % (template_id, len(questions))
        )
        return

    scores: list[float] = []
    per_item: list[list[int]] = [[] for _ in likert]
    open_answers: dict[str, list[str]] = {str(q.get("content")): [] for q in open_items}
    for row in rows:
        values: list[int] = []
        for index, question in enumerate(likert):
            raw_value = str(row.get(str(question.get("content")), "")).strip()
            try:
                value = int(float(raw_value))
            except ValueError:
                values = []
                break
            values.append(value)
            per_item[index].append(value)
        if values:
            scores.append(sus_score(values))
        for question in open_items:
            text = str(row.get(str(question.get("content")), "")).strip()
            if text:
                open_answers[str(question.get("content"))].append(text)

    print(f"模板 {template_id} · {detail.get('title')}")
    print(f"参与者：{len(rows)} 条导出记录，其中可算分 {len(scores)} 条")
    if not scores:
        return
    print(
        "SUS："
        + json.dumps(
            {
                "mean": round(statistics.mean(scores), 1),
                "sd": round(statistics.stdev(scores), 1) if len(scores) > 1 else None,
                "median": round(statistics.median(scores), 1),
                "min": min(scores),
                "max": max(scores),
                f"gte_{int(REFERENCE_LINE)}_rate": round(
                    sum(1 for s in scores if s >= REFERENCE_LINE) / len(scores), 3
                ),
            },
            ensure_ascii=False,
        )
        + f"   （≥{int(REFERENCE_LINE)} 是惯用参考线，不是校准阈值）"
    )

    #: 逐题归一化贡献（0~4，高=该题体验好）。排序必须按归一化值，否则负向题低分会被误读成"最差"。
    def contribution(index: int) -> float:
        mean = statistics.mean(per_item[index])
        return (mean - 1) if (index + 1) % 2 == 1 else (5 - mean)

    ranked = sorted(range(len(likert)), key=contribution)
    print("逐题贡献（低者在前=最拉低可用性；已按极性归一化，0~4，高为好）：")
    for index in ranked:
        mean = statistics.mean(per_item[index])
        polarity = "正向题" if (index + 1) % 2 == 1 else "负向题"
        print(
            f"  [{index + 1:>2}] 贡献={contribution(index):.2f}  原始均值={mean:.2f}  n={len(per_item[index])}  "
            f"{polarity}  {str(likert[index].get('content'))[:50]}"
        )
    for content, answers in open_answers.items():
        print(f"\n开放题：{content}")
        for text in answers:
            print(f"  - {text}")

    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["row_index", "sus_total"])
            for index, score in enumerate(scores):
                writer.writerow([index, score])
        print(f"\n逐人分数已写入 {args.out}")


if __name__ == "__main__":
    sys.exit(main())
