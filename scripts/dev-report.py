#!/usr/bin/env python3
"""
Generate a development analysis report from git history.

Parses commits following emoji-convention format and produces a
standalone HTML report with Chart.js-powered visualisations.

Usage: python scripts/dev-report.py [--output report.html]
"""

import subprocess
import re
import json
import sys
from datetime import datetime
from collections import defaultdict, Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

_EMOJI_TYPE = {
    "\u2728": "feat",
    "\U0001f41b": "fix",
    "\U0001f4dd": "docs",
    "\u267b\ufe0f": "refactor",
    "\U0001f527": "chore",
    "\u2705": "test",
    "\U0001f3a8": "style",
    "\U0001f680": "ci",
    "\U0001f4e6": "build",
    "\u26a1": "perf",
    "\U0001f500": "merge",
    "\U0001f512": "security",
    "\U0001f5c3\ufe0f": "db",
    "\u23ea": "revert",
    "\U0001f525": "remove",
    "\U0001f484": "style",
    "\U0001f3d7\ufe0f": "refactor",
    "\U0001f433": "build",
}

_TYPE_LABEL = {
    "feat": "Feature",
    "fix": "Fix",
    "docs": "Docs",
    "refactor": "Refactor",
    "chore": "Chore",
    "test": "Test",
    "style": "Style",
    "ci": "CI/CD",
    "build": "Build",
    "perf": "Perf",
    "merge": "Merge",
    "security": "Security",
    "db": "Database",
    "revert": "Revert",
    "remove": "Remove",
    "restructure": "Refactor",
    "type": "Chore",
    "docker": "Build",
    "other": "Other",
}

_TYPE_COLOR = {
    "feat": "#4ade80",
    "fix": "#f87171",
    "docs": "#60a5fa",
    "refactor": "#c084fc",
    "chore": "#94a3b8",
    "test": "#facc15",
    "style": "#fb923c",
    "ci": "#2dd4bf",
    "build": "#a78bfa",
    "perf": "#f472b6",
    "merge": "#818cf8",
    "security": "#f43f5e",
    "db": "#38bdf8",
    "revert": "#9ca3af",
    "remove": "#fb7185",
    "other": "#6b7280",
}

_TYPE_ALIAS = {
    "restructure": "refactor",
    "type": "chore",
    "docker": "build",
}

_FALLBACK_RE = re.compile(r"^(?P<type>\w+)(?:\([^)]*\))?\s*:\s*")
_REVERT_RE = re.compile(r'^Revert\s+"')
_MERGE_PR_RE = re.compile(r"^Merge pull request #(?P<pr>\d+) from (?P<branch>\S+)")
_MERGE_BRANCH_RE = re.compile(r"^Merge branch '(?P<branch>[^']+)'(?: into (?P<into>\S+))?")


def _strip_emoji(subject: str) -> str:
    """Strip leading emoji + variation selector from subject line."""
    i = 0
    while i < len(subject):
        cp = subject[i]
        if cp == "\ufe0f":
            i += 1
            continue
        if cp in _EMOJI_TYPE:
            i += 1
            continue
        if ord(cp) > 0x2000 and not cp.isascii():
            cat = _unicode_cat(ord(cp))
            if cat and cat[0] in ("S", "P"):
                i += 1
                continue
        break
    return subject[i:].lstrip()


def _unicode_cat(cp: int) -> str | None:
    """Quick category lookup via ranges."""
    import unicodedata

    try:
        return unicodedata.category(chr(cp))
    except ValueError:
        return None


def git_log() -> list[dict]:
    cmd = [
        "git",
        "log",
        "--format=%H%x00%ai%x00%s",
        "--date-order",
    ]
    raw = subprocess.check_output(
        cmd, cwd=str(ROOT), text=True, encoding="utf-8", errors="replace"
    ).strip()
    if not raw:
        return []

    commits = []
    for line in raw.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\0")
        if len(parts) < 3:
            continue
        sha, date_str, subject = parts[0], parts[1], parts[2]
        try:
            dt = datetime.fromisoformat(date_str.replace(" ", "T"))
        except ValueError:
            dt = datetime.strptime(date_str[:19], "%Y-%m-%dT%H:%M:%S")

        subject = subject.lstrip("\ufeff")

        merge_pr = _MERGE_PR_RE.match(subject)
        merge_branch = _MERGE_BRANCH_RE.match(subject)
        if merge_pr or merge_branch:
            ctype = "merge"
            if merge_pr:
                subject = f"{subject}  [{merge_pr.group('branch')}]"
            else:
                subject = f"Merge: {merge_branch.group('branch')} → {merge_branch.group('into') or 'current'}"
        elif _REVERT_RE.match(subject):
            ctype = "revert"
        else:
            subject = _strip_emoji(subject)
            m = _FALLBACK_RE.match(subject)
            if m:
                raw_type = m.group("type").lower()
                ctype = _TYPE_ALIAS.get(raw_type, raw_type)
                if ctype not in _TYPE_LABEL:
                    ctype = "other"
            else:
                ctype = "other"
        commits.append(
            {
                "sha": sha[:7],
                "date": dt,
                "type": ctype,
                "subject": subject,
            }
        )

    return commits


def date_key(dt: datetime) -> str:
    return dt.strftime("%m-%d")


def build_report_data(commits: list[dict]) -> dict:
    commits.sort(key=lambda c: c["date"])
    first = commits[0]["date"]
    last = commits[-1]["date"]
    total = len(commits)
    total_days = max((last - first).days, 1)

    type_counts = Counter(c["type"] for c in commits)
    top_type = type_counts.most_common(1)[0][0]

    daily = defaultdict(lambda: defaultdict(int))
    for c in commits:
        daily[date_key(c["date"])][c["type"]] += 1

    day_labels = sorted(daily.keys())
    types_in_use = sorted(
        [t for t in type_counts if t != "other"],
        key=lambda t: type_counts[t],
        reverse=True,
    )
    if "other" in type_counts:
        types_in_use.append("other")

    return {
        "first_date": first.strftime("%Y-%m-%d"),
        "last_date": last.strftime("%Y-%m-%d"),
        "total": total,
        "total_days": total_days,
        "active_days": len(day_labels),
        "avg_daily": round(total / total_days, 1),
        "top_type": top_type,
        "top_type_label": _TYPE_LABEL.get(top_type, top_type),
        "type_counts": dict(type_counts.most_common()),
        "types": types_in_use,
        "days": day_labels,
        "daily_data": {
            d: {t: daily[d].get(t, 0) for t in types_in_use} for d in day_labels
        },
        "commit_list": commits[:50],
    }


def render_html(data: dict) -> str:
    chart_datasets = []
    for t in data["types"]:
        values = [data["daily_data"][d].get(t, 0) for d in data["days"]]
        chart_datasets.append(
            {
                "label": _TYPE_LABEL.get(t, t),
                "data": values,
                "backgroundColor": _TYPE_COLOR.get(t, "#6b7280"),
            }
        )

    doughnut_data = [
        {
            "label": _TYPE_LABEL.get(t, t),
            "value": data["type_counts"][t],
            "color": _TYPE_COLOR.get(t, "#6b7280"),
        }
        for t in data["types"]
    ]

    return f"""<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nursing VP Sim · Dev Report {data["first_date"]} → {data["last_date"]}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e1e4e8;padding:32px 20px;max-width:960px;margin:0 auto}}
h1{{font-size:1.5rem;font-weight:600;margin-bottom:4px}}
.subtitle{{color:#8b949e;font-size:.875rem;margin-bottom:28px}}
.stats{{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:32px}}
.card{{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 20px;flex:1;min-width:140px}}
.card .label{{font-size:.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:.05em}}
.card .value{{font-size:1.5rem;font-weight:700;margin-top:4px}}
.charts{{display:grid;grid-template-columns:2fr 1fr;gap:24px;margin-bottom:32px}}
@media(max-width:700px){{.charts{{grid-template-columns:1fr}}}}
.chart-box{{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:24px}}
.chart-box h2{{font-size:.875rem;color:#8b949e;margin-bottom:16px;text-transform:uppercase;letter-spacing:.05em}}
canvas{{width:100%!important}}
.footer{{text-align:center;color:#484f58;font-size:.75rem;margin-top:32px}}
</style>
</head>
<body>
<h1>Nursing VP Sim · Development Report</h1>
<p class="subtitle">{data["first_date"]} → {data["last_date"]} &middot; {data["total"]} commits &middot; {data["total_days"]} days</p>

<div class="stats">
  <div class="card"><div class="label">Total Commits</div><div class="value">{data["total"]}</div></div>
  <div class="card"><div class="label">Avg / Day</div><div class="value">{data["avg_daily"]}</div></div>
  <div class="card"><div class="label">Active Days</div><div class="value">{data["active_days"]}</div></div>
  <div class="card"><div class="label">Top Type</div><div class="value">{_TYPE_LABEL.get(data["top_type"], data["top_type"])}</div></div>
  <div class="card"><div class="label">Commit Types</div><div class="value">{len(data["types"])}</div></div>
</div>

<div class="charts">
  <div class="chart-box">
    <h2>Daily Commit Trend</h2>
    <canvas id="trendChart"></canvas>
  </div>
  <div class="chart-box">
    <h2>Type Distribution</h2>
    <canvas id="doughnutChart"></canvas>
  </div>
</div>

<p class="footer">Generated {datetime.now().strftime("%Y-%m-%d %H:%M")} &middot; <code>python scripts/dev-report.py</code></p>

<script>
const weeks = {json.dumps(data["days"])};
const datasets = {json.dumps(chart_datasets)};
const doughnutData = {json.dumps(doughnut_data)};

new Chart(document.getElementById("trendChart"), {{
  type: "bar",
  data: {{ labels: weeks, datasets }},
  options: {{
    responsive: true,
    plugins: {{ legend: {{ labels: {{ color: "#8b949e", boxWidth: 12, padding: 12, font: {{ size: 11 }} }} }} }},
    scales: {{
      x: {{ stacked: true, ticks: {{ color: "#8b949e", font: {{ size: 9 }}, maxTicksLimit: 30, maxRotation: 45 }}, grid: {{ color: "#21262d" }} }},
      y: {{ stacked: true, ticks: {{ color: "#8b949e", font: {{ size: 10 }} }}, grid: {{ color: "#21262d" }} }}
    }},
    interaction: {{ mode: "index" }}
  }}
}});

new Chart(document.getElementById("doughnutChart"), {{
  type: "doughnut",
  data: {{
    labels: doughnutData.map(d => d.label),
    datasets: [{{ data: doughnutData.map(d => d.value), backgroundColor: doughnutData.map(d => d.color), borderColor: "#161b22", borderWidth: 2 }}]
  }},
  options: {{
    responsive: true,
    plugins: {{ legend: {{ position: "bottom", labels: {{ color: "#8b949e", boxWidth: 10, padding: 10, font: {{ size: 10 }} }} }} }}
  }}
}});
</script>
</body>
</html>"""


def main():
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = ROOT / f"dev-report-{ts}.html"
    for a in sys.argv[1:]:
        if a.startswith("--output="):
            out = Path(a.split("=", 1)[1])
        elif a == "--output" and len(sys.argv) > sys.argv.index(a) + 1:
            out = Path(sys.argv[sys.argv.index(a) + 1])

    commits = git_log()
    if not commits:
        print("No commits found.")
        sys.exit(1)

    data = build_report_data(commits)
    html = render_html(data)
    out.write_text(html, encoding="utf-8")
    print(f"Report written to {out.resolve()}")


if __name__ == "__main__":
    main()
