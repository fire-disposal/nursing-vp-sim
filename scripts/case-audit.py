#!/usr/bin/env python3
"""case-audit — 病例健康一键诊断（快反工具）。

用法：
  uv run python scripts/case-audit.py             # 全量校验 + 分组摘要
  uv run python scripts/case-audit.py --json      # 机器可读（喂给 AI 代理做修复）
  uv run python scripts/case-audit.py --case 9    # 单病例深查

退出码：0 = 无 error；1 = 存在 error（供 CI 门禁使用）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from modules.cases.validator import load_cases_from_dir, validate_cases

CASES_DIR = Path(__file__).resolve().parent.parent / "backend" / "data" / "cases"

SEV_ORDER = {"error": 0, "warning": 1, "info": 2}
SEV_LABEL = {"error": "ERROR", "warning": "WARN ", "info": "INFO "}


def main() -> int:
    parser = argparse.ArgumentParser(description="病例数据健康诊断")
    parser.add_argument("--json", action="store_true", help="机器可读 JSON 输出")
    parser.add_argument("--case", type=str, default=None, help="只检查指定文件（如 9 或 case9）")
    args = parser.parse_args()

    cases = load_cases_from_dir(CASES_DIR)
    if args.case:
        key = f"case{args.case}" if args.case.isdigit() else args.case
        if key not in cases:
            print(f"未知病例文件: {key}", file=sys.stderr)
            return 2
        cases = {key: cases[key]}

    reports = validate_cases(cases)

    if args.json:
        payload = {
            fname: {
                "issues": [
                    {"severity": i.severity, "field": i.field, "message": i.message, "fix_hint": i.fix_hint}
                    for i in r.issues
                ]
            }
            for fname, r in reports.items()
        }
        print(json.dumps(payload, ensure_ascii=False, indent=1))
    else:
        for fname in sorted(reports):
            r = reports[fname]
            by_sev: dict[str, list] = {"error": [], "warning": [], "info": []}
            for i in r.issues:
                by_sev[i.severity].append(i)
            print(f"\n== {fname} — {r.name}  (error={len(by_sev['error'])} warn={len(by_sev['warning'])})")
            for sev in ("error", "warning", "info"):
                for i in by_sev[sev]:
                    print(f"  [{SEV_LABEL[sev]}] {i.field or '-'}: {i.message}")
                    if i.fix_hint:
                        print(f"        → {i.fix_hint}")
        total_errors = sum(len(r.errors) for r in reports.values())
        print(f"\n总计: {len(reports)} 个病例, {total_errors} 个 error")

    return 1 if any(r.errors for r in reports.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
