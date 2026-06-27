#!/usr/bin/env python3
"""
Generate a development analysis report from git history.

Parses emoji-convention commits into typed categories and produces a
standalone HTML report with Chart.js visualisations.

Usage: python scripts/dev-report.py [--output report.html] [--weeks N] [--open]
"""

import subprocess
import re
import json
import sys
import webbrowser
from datetime import datetime, timedelta
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
}

_TYPE_LABEL = {
    "feat": "Feature", "fix": "Fix", "docs": "Docs", "refactor": "Refactor",
    "chore": "Chore", "test": "Test", "style": "Style", "ci": "CI/CD",
    "build": "Build", "perf": "Perf", "merge": "Merge", "security": "Security",
    "db": "Database", "revert": "Revert", "remove": "Remove", "other": "Other",
}

_TYPE_COLOR = {
    "feat": "#4ade80", "fix": "#f87171", "docs": "#60a5fa",
    "refactor": "#c084fc", "chore": "#94a3b8", "test": "#facc15",
    "style": "#fb923c", "ci": "#2dd4bf", "build": "#a78bfa",
    "perf": "#f472b6", "merge": "#818cf8", "security": "#f43f5e",
    "db": "#38bdf8", "revert": "#9ca3af", "remove": "#fb7185",
    "other": "#6b7280",
}

_TYPE_ALIAS = {"restructure": "refactor", "type": "chore", "docker": "build"}

_FALLBACK_RE = re.compile(r"^(?P<type>\w+)(?:\([^)]*\))?\s*:\s*")
_REVERT_RE = re.compile(r'^Revert\s+"')
_MERGE_PR_RE = re.compile(r"^Merge pull request #(?P<pr>\d+) from (?P<branch>\S+)")
_MERGE_BRANCH_RE = re.compile(r"^Merge branch '(?P<branch>[^']+)'(?: into (?P<into>\S+))?")


def _strip_emoji(subject: str) -> str:
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
            import unicodedata
            try:
                cat = unicodedata.category(cp)
            except ValueError:
                break
            if cat and cat[0] in ("S", "P"):
                i += 1
                continue
        break
    return subject[i:].lstrip()


def git_log() -> list[dict]:
    cmd = ["git", "log", "--format=%H%x00%ai%x00%an%x00%s", "--date-order"]
    raw = subprocess.check_output(cmd, cwd=str(ROOT), text=True, encoding="utf-8", errors="replace").strip()
    if not raw:
        return []

    commits = []
    for line in raw.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\0")
        if len(parts) < 4:
            continue
        sha, date_str, author, subject = parts[0], parts[1], parts[2], parts[3]
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
                subject = f"PR #{merge_pr.group('pr')} — {merge_pr.group('branch')}"
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

        commits.append({"sha": sha[:7], "date": dt, "author": author, "type": ctype, "subject": subject})

    return commits


def date_key(dt: datetime) -> str:
    return dt.strftime("%m-%d")


def build_report_data(commits: list[dict], weeks: int = 0) -> dict:
    commits.sort(key=lambda c: c["date"])
    if not commits:
        return {}

    first = commits[0]["date"]
    last = commits[-1]["date"]

    if weeks > 0:
        cutoff = datetime.now() - timedelta(weeks=weeks)
        commits = [c for c in commits if c["date"] >= cutoff]
        if commits:
            first = commits[0]["date"]
            last = commits[-1]["date"]

    total = len(commits)
    total_days = max((last - first).days, 1)

    type_counts = Counter(c["type"] for c in commits)
    top_type = type_counts.most_common(1)[0][0] if type_counts else "other"

    author_counts = Counter(c["author"] for c in commits)
    top_authors = author_counts.most_common(5)

    daily = defaultdict(lambda: defaultdict(int))
    for c in commits:
        daily[date_key(c["date"])][c["type"]] += 1

    day_labels = sorted(daily.keys())
    types_in_use = sorted([t for t in type_counts if t != "other"], key=lambda t: type_counts[t], reverse=True)
    if "other" in type_counts:
        types_in_use.append("other")

    # Weekly breakdown
    weekly = defaultdict(int)
    for c in commits:
        week = c["date"].strftime("%Y-W%U")
        weekly[week] += 1
    top_weeks = sorted(weekly.items(), key=lambda x: x[1], reverse=True)[:5]
    avg_weekly = round(total / max(len(weekly), 1), 1)

    return {
        "first_date": first.strftime("%Y-%m-%d"),
        "last_date": last.strftime("%Y-%m-%d"),
        "total": total,
        "total_days": total_days,
        "active_days": len(day_labels),
        "avg_daily": round(total / total_days, 1),
        "avg_weekly": avg_weekly,
        "top_type": top_type,
        "top_type_label": _TYPE_LABEL.get(top_type, top_type),
        "type_counts": dict(type_counts.most_common()),
        "types": types_in_use,
        "days": day_labels,
        "daily_data": {d: {t: daily[d].get(t, 0) for t in types_in_use} for d in day_labels},
        "top_authors": [{"name": a, "count": c, "pct": round(c / total * 100, 1)} for a, c in top_authors],
        "top_weeks": [{"week": w, "count": c} for w, c in top_weeks],
        "commit_list": commits[-80:],
        "total_authors": len(author_counts),
    }


def _card(label: str, value: str, color: str = "") -> str:
    style = f' style="color:{color}"' if color else ""
    return f'<div class="card"><div class="label">{label}</div><div class="value"{style}>{value}</div></div>'


def _commit_row(c: dict) -> str:
    color = _TYPE_COLOR.get(c["type"], "#6b7280")
    return (
        f'<tr>'
        f'<td style="color:#484f58;font-family:mono;font-size:.75rem">{c["sha"]}</td>'
        f'<td style="color:{color};font-weight:500;font-size:.75rem">{_TYPE_LABEL.get(c["type"], c["type"])}</td>'
        f'<td style="font-size:.8rem">{c["subject"][:80]}</td>'
        f'<td style="color:#8b949e;font-size:.75rem;text-align:right;white-space:nowrap">{c["author"]}</td>'
        f'<td style="color:#484f58;font-size:.7rem">{c["date"].strftime("%m-%d %H:%M")}</td>'
        f'</tr>'
    )


def render_html(data: dict) -> str:
    if not data:
        return "<html><body>No commits found.</body></html>"

    chart_datasets = []
    for t in data["types"]:
        values = [data["daily_data"][d].get(t, 0) for d in data["days"]]
        chart_datasets.append({
            "label": _TYPE_LABEL.get(t, t),
            "data": values,
            "backgroundColor": _TYPE_COLOR.get(t, "#6b7280"),
        })

    doughnut_data = [
        {"label": _TYPE_LABEL.get(t, t), "value": data["type_counts"][t], "color": _TYPE_COLOR.get(t, "#6b7280")}
        for t in data["types"]
    ]

    authors_html = "".join(
        f'<div class="author-bar">'
        f'<span class="author-name">{a["name"]}</span>'
        f'<span class="author-count">{a["count"]} ({a["pct"]}%)</span>'
        f'<div class="author-fill" style="width:{a["pct"]}%;background:{_TYPE_COLOR.get(data["top_type"], "#4ade80")}"></div>'
        f'</div>'
        for a in data["top_authors"]
    )

    week_rows = "".join(
        f'<tr><td>{w["week"]}</td><td class="r">{w["count"]}</td></tr>'
        for w in data["top_weeks"]
    )

    commit_rows = "".join(_commit_row(c) for c in reversed(data["commit_list"]))

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nursing VP Sim · Dev Report {data["first_date"]} → {data["last_date"]}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
:root{{--bg:#0f1117;--card:#161b22;--border:#30363d;--text:#e1e4e8;--dim:#8b949e;--muted:#484f58}}
@media(prefers-color-scheme:light){{
  :root{{--bg:#ffffff;--card:#f6f8fa;--border:#d0d7de;--text:#1f2328;--dim:#656d76;--muted:#afb8c1}}
}}
body{{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);padding:32px 20px 60px;max-width:1024px;margin:0 auto;font-size:14px}}
h1{{font-size:1.4rem;font-weight:600;margin-bottom:2px}}
.subtitle{{color:var(--dim);font-size:.85rem;margin-bottom:32px}}
.stats{{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:28px}}
.card{{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px 20px;flex:1;min-width:130px}}
.card .label{{font-size:.7rem;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}}
.card .value{{font-size:1.4rem;font-weight:700;margin-top:4px}}
.grid{{display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:28px}}
@media(max-width:750px){{.grid{{grid-template-columns:1fr}}}}
.box{{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px}}
.box h2{{font-size:.8rem;color:var(--dim);margin-bottom:16px;text-transform:uppercase;letter-spacing:.05em;font-weight:500}}
canvas{{width:100%!important}}
.author-bar{{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);position:relative}}
.author-bar:last-child{{border-bottom:none}}
.author-name{{font-weight:500;font-size:.8rem;flex:0 0 100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.author-count{{font-size:.75rem;color:var(--dim);flex:0 0 60px;text-align:right}}
.author-fill{{height:4px;border-radius:2px;position:absolute;bottom:0;left:0;opacity:.3;transition:width .3s}}
table{{width:100%;border-collapse:collapse;font-size:.8rem}}
th{{text-align:left;padding:8px 10px;border-bottom:2px solid var(--border);font-size:.7rem;color:var(--dim);text-transform:uppercase;font-weight:500}}
td{{padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:middle}}
td.r{{text-align:right}}
tr:hover td{{background:var(--border);opacity:.5}}
.commit-table{{max-height:500px;overflow-y:auto}}
.footer{{text-align:center;color:var(--muted);font-size:.7rem;margin-top:36px}}
</style>
</head>
<body>
<h1>Nursing VP Sim · Development Report</h1>
<p class="subtitle">{data["first_date"]} → {data["last_date"]} &middot; {data["total"]} commits &middot; {data["total_days"]} days &middot; {data["total_authors"]} authors</p>

<div class="stats">
  {_card("Total Commits", str(data["total"]))}
  {_card("Avg / Day", str(data["avg_daily"]))}
  {_card("Avg / Week", str(data["avg_weekly"]))}
  {_card("Active Days", str(data["active_days"]))}
  {_card("Top Type", _TYPE_LABEL.get(data["top_type"], data["top_type"]), _TYPE_COLOR.get(data["top_type"], ""))}
  {_card("Authors", str(data["total_authors"]))}
</div>

<div class="grid">
  <div class="box">
    <h2>Daily Commit Trend</h2>
    <canvas id="trendChart"></canvas>
  </div>
  <div class="box">
    <h2>Type Distribution</h2>
    <canvas id="doughnutChart"></canvas>
  </div>
</div>

<div class="grid">
  <div class="box">
    <h2>Top Contributors</h2>
    {authors_html}
  </div>
  <div class="box">
    <h2>Busiest Weeks</h2>
    <table>
      <tr><th>Week</th><th class="r">Commits</th></tr>
      {week_rows}
    </table>
  </div>
</div>

<div class="box" style="margin-bottom:28px">
  <h2>Recent Commits</h2>
  <div class="commit-table">
    <table>
      <tr><th>SHA</th><th>Type</th><th>Message</th><th style="text-align:right">Author</th><th>Date</th></tr>
      {commit_rows}
    </table>
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
    plugins: {{ legend: {{ labels: {{ color: getComputedStyle(document.body).getPropertyValue("--dim"), boxWidth: 12, padding: 12, font: {{ size: 11 }} }} }} }},
    scales: {{
      x: {{ stacked: true, ticks: {{ color: getComputedStyle(document.body).getPropertyValue("--dim"), font: {{ size: 9 }}, maxTicksLimit: 30, maxRotation: 45 }}, grid: {{ color: getComputedStyle(document.body).getPropertyValue("--border") }} }},
      y: {{ stacked: true, ticks: {{ color: getComputedStyle(document.body).getPropertyValue("--dim"), font: {{ size: 10 }} }}, grid: {{ color: getComputedStyle(document.body).getPropertyValue("--border") }} }}
    }},
    interaction: {{ mode: "index" }}
  }}
}});

new Chart(document.getElementById("doughnutChart"), {{
  type: "doughnut",
  data: {{ labels: doughnutData.map(d => d.label), datasets: [{{ data: doughnutData.map(d => d.value), backgroundColor: doughnutData.map(d => d.color), borderColor: getComputedStyle(document.body).getPropertyValue("--card"), borderWidth: 2 }}] }},
  options: {{ responsive: true, plugins: {{ legend: {{ position: "bottom", labels: {{ color: getComputedStyle(document.body).getPropertyValue("--dim"), boxWidth: 10, padding: 10, font: {{ size: 10 }} }} }} }} }}
}});
</script>
</body>
</html>"""


def main():
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = ROOT / f"dev-report-{ts}.html"
    weeks = 0
    auto_open = False
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--output="):
            out = Path(a.split("=", 1)[1])
        elif a == "--output" and i + 1 < len(args):
            i += 1; out = Path(args[i])
        elif a.startswith("--weeks="):
            weeks = int(a.split("=", 1)[1])
        elif a == "--weeks" and i + 1 < len(args):
            i += 1; weeks = int(args[i])
        elif a == "--open":
            auto_open = True
        i += 1

    commits = git_log()
    if not commits:
        print("No commits found.")
        sys.exit(1)

    data = build_report_data(commits, weeks=weeks)
    html = render_html(data)
    out = Path(out)
    out.write_text(html, encoding="utf-8")
    print(f"Report written to {out.resolve()}")
    if auto_open:
        webbrowser.open(str(out.resolve()))


if __name__ == "__main__":
    main()
