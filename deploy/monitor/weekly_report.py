#!/usr/bin/env python3
"""
Weekly server report — cyberpunk-themed HTML email.
Collects server overview, container status, resource stats.
Designed for crontab: 0 9 * * 1 cd /opt/monitor && python3 weekly_report.py
"""

import json
import os
import subprocess
import smtplib
import sys
import time
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
STATE_FILE = SCRIPT_DIR / "state.json"

sys.path.insert(0, str(SCRIPT_DIR))
try:
    from config import *  # noqa: F403
except ImportError:
    pass

HOSTNAME = "yeacoyun"
NOW = datetime.now()
WEEK_AGO = NOW - timedelta(days=7)

# ── Helpers ───────────────────────────────────────────────────────────────────

def run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except Exception:
        return -1, ""


def dur(s):
    """Parse docker uptime string like 'Up 5 days' to hours."""
    s = s.lower().replace("up ", "")
    total_h = 0
    for part in s.split():
        part = part.strip(",")
        if part.endswith("day") or part.endswith("days"):
            try:
                total_h += int(part.replace("day", "").replace("s", "").strip()) * 24
            except ValueError:
                pass
        elif part.endswith("hour") or part.endswith("hours"):
            try:
                total_h += int(part.replace("hour", "").replace("s", "").strip())
            except ValueError:
                pass
        elif part.endswith("minute") or part.endswith("minutes"):
            try:
                total_h += int(part.replace("minute", "").replace("s", "").strip()) / 60
            except ValueError:
                pass
    return round(total_h, 1)


# ── Data collectors ───────────────────────────────────────────────────────────

def collect_system():
    info = {"hostname": HOSTNAME, "os": "", "uptime": "", "load": "", "time": NOW.strftime("%Y-%m-%d %H:%M:%S")}

    with open("/etc/os-release") as f:
        for line in f:
            if line.startswith("PRETTY_NAME="):
                info["os"] = line.split("=", 1)[1].strip().strip('"')
                break

    rc, out = run("uptime -p")
    if rc == 0:
        info["uptime"] = out

    try:
        info["load"] = Path("/proc/loadavg").read_text().strip()
    except Exception:
        info["load"] = "?"

    return info


def collect_resources():
    info = {"disk": {}, "mem": {}, "cpu_cores": os.cpu_count() or 1}

    # Disk
    rc, out = run("df -h / | tail -1")
    if rc == 0:
        parts = out.split()
        if len(parts) >= 5:
            info["disk"] = {"total": parts[1], "used": parts[2], "avail": parts[3], "pct": parts[4]}

    # Memory
    try:
        meminfo = Path("/proc/meminfo").read_text()
        mem = {}
        for line in meminfo.splitlines():
            parts = line.split(":")
            if len(parts) >= 2:
                try:
                    mem[parts[0].strip()] = int(parts[1].strip().split()[0])
                except ValueError:
                    pass
        info["mem"] = {
            "total_mb": mem.get("MemTotal", 0) // 1024,
            "avail_mb": mem.get("MemAvailable", 0) // 1024,
            "pct": round((1 - mem.get("MemAvailable", 0) / max(mem.get("MemTotal", 1), 1)) * 100, 1),
        }
    except Exception:
        info["mem"] = {"total_mb": "?", "avail_mb": "?", "pct": "?"}

    return info


def collect_containers():
    containers = []
    rc, out = run("docker ps -a --format json")
    if rc != 0:
        return containers

    for line in out.splitlines():
        if not line.strip():
            continue
        try:
            c = json.loads(line)
        except json.JSONDecodeError:
            continue

        state = c.get("State", "?")
        status = c.get("Status", "")
        healthy = "healthy" in status.lower() if state == "running" else False
        unhealthy = "unhealthy" in status.lower()

        containers.append({
            "name": c.get("Names", "?"),
            "image": c.get("Image", "?"),
            "state": state,
            "healthy": healthy,
            "unhealthy": unhealthy,
            "uptime": c.get("RunningFor", "?"),
            "uptime_h": dur(c.get("RunningFor", "")) if state == "running" else 0,
            "status_short": "healthy" if healthy else ("unhealthy" if unhealthy else state),
        })

    containers.sort(key=lambda x: (0 if x["state"] == "running" else 1, -x["uptime_h"]))
    return containers


def collect_docker_stats():
    stats = []
    rc, out = run(
        "docker stats --no-stream "
        "--format '{{.Name}}\t{{.CPUPerc}}\t{{.MemPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}'"
    )
    if rc != 0:
        return stats
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 6:
            stats.append({
                "name": parts[0],
                "cpu": parts[1],
                "mem_pct": parts[2],
                "mem_usage": parts[3],
                "net_io": parts[4],
                "block_io": parts[5],
            })
    return stats


def collect_recent_alerts():
    alerts = []
    if not STATE_FILE.exists():
        return alerts
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return alerts
    for key, entry in state.items():
        if key.startswith("_"):
            continue
        try:
            last = datetime.fromisoformat(entry["last_alert"])
        except Exception:
            continue
        if last >= WEEK_AGO:
            alerts.append({
                "key": key,
                "count": entry.get("count", 0),
                "last": last.strftime("%m-%d %H:%M"),
                "resolved": entry.get("resolved", False),
                "detail": entry.get("detail", ""),
            })
    alerts.sort(key=lambda x: x["last"], reverse=True)
    return alerts


# ── HTML builder ──────────────────────────────────────────────────────────────

CSS = """
:root{color-scheme:light dark}
body{margin:0;padding:24px;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:14px;color:#1e293b;line-height:1.5}
.container{max-width:720px;margin:0 auto}
.header{padding:16px 0 24px;border-bottom:2px solid #e2e8f0}
.header h1{font-size:20px;font-weight:700;margin:0;color:#2563eb}
.header .sub{font-size:12px;color:#94a3b8;margin-top:4px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px 24px;margin-top:16px}
.card h2{font-size:13px;font-weight:600;margin:0 0 16px;color:#475569;text-transform:uppercase;letter-spacing:0.5px}
.row{display:flex;flex-wrap:wrap;gap:16px}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.tag-ok{background:#ecfdf5;color:#059669}
.tag-warn{background:#fffbeb;color:#d97706}
.tag-err{background:#fef2f2;color:#dc2626}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px}
td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
tr:last-child td{border-bottom:none}
.metric{flex:1;min-width:100px;padding:16px;background:#f8fafc;border-radius:6px;text-align:center}
.metric .val{font-size:22px;font-weight:700;color:#2563eb}
.metric .lbl{font-size:11px;color:#94a3b8;margin-top:4px}
.metric .sub{font-size:11px;color:#64748b;margin-top:2px}
.bar-wrap{height:6px;background:#e2e8f0;border-radius:3px;margin-top:8px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px}
.bar-ok{background:#22c55e}
.bar-warn{background:#f59e0b}
.bar-err{background:#ef4444}
.footer{margin-top:20px;text-align:center;font-size:11px;color:#cbd5e1}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:middle}
.dot-ok{background:#22c55e}
.dot-err{background:#ef4444}
.dot-warn{background:#f59e0b}
.chart-row{display:flex;align-items:center;margin-bottom:10px;gap:10px}
.chart-label{width:160px;font-size:11px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}
.chart-bar-wrap{flex:1;height:18px;background:#e2e8f0;border-radius:4px;overflow:hidden;position:relative}
.chart-bar{height:100%;border-radius:4px;transition:width .3s}
.chart-bar-cpu{background:linear-gradient(90deg,#3b82f6,#60a5fa)}
.chart-bar-mem{background:linear-gradient(90deg,#8b5cf6,#a78bfa)}
.chart-val{width:48px;font-size:11px;font-weight:600;text-align:left;flex-shrink:0}
@media (prefers-color-scheme:dark){
  body{background:#0f1117;color:#c9d1d9}
  .header{border-bottom-color:#21262d}
  .header h1{color:#58a6ff}
  .header .sub{color:#8b949e}
  .card{background:#161b22;border-color:#21262d}
  .card h2{color:#8b949e}
  .tag-ok{background:rgba(63,185,80,0.12);color:#3fb950}
  .tag-warn{background:rgba(210,153,34,0.12);color:#d29922}
  .tag-err{background:rgba(248,81,73,0.12);color:#f85149}
  th{border-bottom-color:#21262d;color:#8b949e}
  td{border-bottom-color:#161b22}
  .metric{background:#0d1117}
  .metric .val{color:#58a6ff}
  .metric .lbl{color:#8b949e}
  .metric .sub{color:#8b949e}
  .bar-wrap{background:#21262d}
  .footer{color:#30363d}
  .chart-bar-wrap{background:#21262d}
  .chart-bar-cpu{background:linear-gradient(90deg,#1f6feb,#58a6ff)}
  .chart-bar-mem{background:linear-gradient(90deg,#6e40c9,#a371f7)}
}
"""


def bar(pct, label=""):
    """Render a progress bar. pct is numeric (int/float) or string like '70%'."""
    try:
        v = float(str(pct).replace("%", ""))
    except ValueError:
        return ""
    if v >= 85:
        cls = "bar-err"
    elif v >= 70:
        cls = "bar-warn"
    else:
        cls = "bar-ok"
    return f'<div class="bar-wrap"><div class="bar-fill {cls}" style="width:{v}%"></div></div>'


def tag(status):
    ok_set = {"running", "healthy", "normal", "running", "运行中", "正常"}
    err_set = {"exited", "unhealthy", "dead", "已停止", "异常", "已死亡"}
    cls = "tag-ok" if status in ok_set else ("tag-err" if status in err_set else "tag-warn")
    label = status.upper() if status.isascii() else status
    return f'<span class="tag {cls}">{label}</span>'


def metric(val, label, pct=None, sub=None):
    bar_html = bar(pct) if pct is not None else ""
    sub_html = f'<div class="sub">{sub}</div>' if sub else ""
    return f'<div class="metric"><div class="val">{val}</div><div class="lbl">{label}</div>{sub_html}{bar_html}</div>'


def status_cn(s):
    m = {"healthy": "正常", "unhealthy": "异常", "running": "运行中", "exited": "已停止", "dead": "已死亡"}
    return m.get(s, s)


def build_html(sys_info, res, containers, stats, alerts):
    running = sum(1 for c in containers if c["state"] == "running")
    stopped = sum(1 for c in containers if c["state"] != "running")

    rows = ""
    for c in containers:
        st = status_cn(c['status_short'])
        rows += (
            f"<tr><td>{c['name']}</td><td style='font-size:11px;color:var(--c-dim,#94a3b8)'>{c['image'][:54]}</td>"
            f"<td>{tag(st)}</td><td style='font-size:12px'>{c['uptime']}</td></tr>"
        )

    stats_rows = ""
    for s in stats:
        cpu_class = "color:#dc2626" if float(s['cpu'].replace('%','')) > 80 else ""
        mem_class = "color:#dc2626" if float(s['mem_pct'].replace('%','')) > 80 else ""
        stats_rows += (
            f"<tr><td>{s['name']}</td><td style='{cpu_class}'>{s['cpu']}</td>"
            f"<td style='{mem_class}'>{s['mem_pct']}</td><td style='font-size:11px'>{s['mem_usage']}</td>"
            f"<td style='font-size:11px'>{s['net_io']}</td>"
            f"<td style='font-size:11px'>{s['block_io']}</td></tr>"
        )

    alert_rows = ""
    if alerts:
        for a in alerts[:20]:
            dot_cls = "dot-ok" if a["resolved"] else "dot-err"
            alert_rows += (
                f"<tr><td><span class='dot {dot_cls}'></span></td><td>{a['key']}</td><td style='font-size:11px'>x{a['count']}</td>"
                f"<td style='font-size:11px'>{a['last']}</td><td style='font-size:11px;color:var(--c-dim,#94a3b8)'>{a['detail'][:60]}</td></tr>"
            )
    else:
        alert_rows = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--c-dim,#94a3b8)">本周无告警</td></tr>'

    range_str = f"{WEEK_AGO.strftime('%m/%d')} &mdash; {NOW.strftime('%m/%d')}"
    css_block = f"<style>{CSS}</style>"

    disk_pct = str(res['disk'].get('pct', '0')).replace('%', '')
    disk_used = res['disk'].get('used', '?')
    disk_total = res['disk'].get('total', '?')
    mem_pct = str(res['mem'].get('pct', '0'))
    mem_avail = res['mem'].get('avail_mb', '?')
    mem_total = res['mem'].get('total_mb', '?')
    load_parts = sys_info.get('load', '?').split()
    load1 = load_parts[0] if load_parts else '?'

    cpu_chart = ""
    cpu_sorted = sorted(stats, key=lambda s: float(s['cpu'].replace('%', '').replace('--', '0')), reverse=True)[:8]
    for s in cpu_sorted:
        v = float(s['cpu'].replace('%', '').replace('--', '0'))
        width = max(v, 2) if v > 0.01 else 0
        cpu_chart += (
            f'<div class="chart-row">'
            f'<span class="chart-label">{s["name"]}</span>'
            f'<div class="chart-bar-wrap"><div class="chart-bar chart-bar-cpu" style="width:{width}%"></div></div>'
            f'<span class="chart-val">{s["cpu"]}</span>'
            f'</div>'
        )

    mem_chart = ""
    mem_sorted = sorted(stats, key=lambda s: float(s['mem_pct'].replace('%', '').replace('--', '0')), reverse=True)[:8]
    for s in mem_sorted:
        v = float(s['mem_pct'].replace('%', '').replace('--', '0'))
        width = max(v, 2) if v > 0.01 else 0
        mem_chart += (
            f'<div class="chart-row">'
            f'<span class="chart-label">{s["name"]}</span>'
            f'<div class="chart-bar-wrap"><div class="chart-bar chart-bar-mem" style="width:{width}%"></div></div>'
            f'<span class="chart-val">{s["mem_pct"]}</span>'
            f'</div>'
        )

    return f"""\
<!DOCTYPE html>
<html><head><meta charset="utf-8" name="color-scheme" content="light dark">{css_block}</head>
<body>
<div class="container">

<div class="header">
  <h1>服务器周报</h1>
  <div class="sub">{sys_info['hostname']} &middot; {range_str}</div>
</div>

<div class="card">
  <h2>系统信息</h2>
  <table>
    <tr><td style="width:120px;font-weight:500">Hostname</td><td>{sys_info['hostname']}</td></tr>
    <tr><td style="font-weight:500">OS</td><td>{sys_info['os']}</td></tr>
    <tr><td style="font-weight:500">运行时间</td><td>{sys_info['uptime']}</td></tr>
    <tr><td style="font-weight:500">Load (1/5/15)</td><td>{sys_info['load']}</td></tr>
    <tr><td style="font-weight:500">生成时间</td><td>{sys_info['time']}</td></tr>
  </table>
</div>

<div class="card">
  <h2>资源使用</h2>
  <div class="row">
    {metric(disk_pct+'%', '磁盘', pct=disk_pct, sub=f'{disk_used} / {disk_total}')}
    {metric(mem_pct+'%', '内存', pct=mem_pct, sub=f'{mem_avail} MB / {mem_total} MB')}
    {metric(load1, 'Load', sub=f'{res["cpu_cores"]} 核')}
  </div>
</div>

<div class="card">
  <h2>容器状态 &mdash; <span style="font-weight:400;font-size:12px">{running} 个运行中</span>{' <span style="font-weight:400;font-size:12px;color:#dc2626">/ '+str(stopped)+' 个已停止</span>' if stopped else ''}</h2>
  <table>
    <tr><th>名称</th><th>镜像</th><th>状态</th><th>运行时长</th></tr>
    {rows}
  </table>
</div>

<div class="card">
  <h2>容器资源统计</h2>
  <table>
    <tr><th>名称</th><th>CPU</th><th>Mem%</th><th>内存</th><th>网络 I/O</th><th>磁盘 I/O</th></tr>
    {stats_rows}
  </table>
</div>

<div class="card">
  <h2>资源占用排行</h2>
  <div style="display:flex;gap:24px;flex-wrap:wrap">
    <div style="flex:1;min-width:280px">
      <h3 style="font-size:11px;color:#64748b;margin:0 0 12px">CPU 占用</h3>
      {cpu_chart}
    </div>
    <div style="flex:1;min-width:280px">
      <h3 style="font-size:11px;color:#64748b;margin:0 0 12px">内存占用</h3>
      {mem_chart}
    </div>
  </div>
</div>

<div class="card">
  <h2>告警记录 (近7天)</h2>
  <table>
    <tr><th></th><th>告警项</th><th>次数</th><th>最近时间</th><th>详情</th></tr>
    {alert_rows}
  </table>
</div>

<div class="footer">
  由 monitor.py 生成于 {NOW.strftime('%Y-%m-%d %H:%M')}
</div>

</div></body></html>"""


# ── Email send ────────────────────────────────────────────────────────────────

def send_email(subject, body_html):
    try:
        config = sys.modules.get("config", None)
        smtp_host = getattr(config, "SMTP_HOST", "")
        smtp_port = getattr(config, "SMTP_PORT", 587)
        smtp_user = getattr(config, "SMTP_USER", "")
        smtp_pass = getattr(config, "SMTP_PASS", "")
        mail_from = getattr(config, "MAIL_FROM", smtp_user)
        mail_to_raw = getattr(config, "MAIL_TO", smtp_user)
        mail_to = mail_to_raw if isinstance(mail_to_raw, list) else [mail_to_raw]

        if not smtp_host:
            print("SMTP not configured, writing to stdout instead")
            print(body_html)
            return

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = mail_from
        msg["To"] = ", ".join(mail_to)
        msg.attach(MIMEText(body_html, "html", "utf-8"))

        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as s:
            s.ehlo()
            s.starttls()
            s.ehlo()
            s.login(smtp_user, smtp_pass)
            s.sendmail(mail_from, mail_to, msg.as_string())
        print(f"Weekly report sent to {', '.join(mail_to)}")
    except Exception as e:
        print(f"Send failed: {e}")
        # Fallback: write to file so it's not lost
        report_file = SCRIPT_DIR / f"report_{NOW.strftime('%Y%m%d')}.html"
        report_file.write_text(body_html, encoding="utf-8")
        print(f"Report saved to {report_file}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"[{NOW.strftime('%Y-%m-%d %H:%M:%S')}] Generating weekly report...")

    sys_info = collect_system()
    res = collect_resources()
    containers = collect_containers()
    stats = collect_docker_stats()
    alerts = collect_recent_alerts()

    html = build_html(sys_info, res, containers, stats, alerts)

    subject = f"[WEEKLY] {HOSTNAME} — {containers.count(lambda c: c['state']=='running') if hasattr(containers, 'count') else len([c for c in containers if c['state']=='running'])}/{len(containers)} containers UP"
    running = sum(1 for c in containers if c["state"] == "running")
    subject = f"[WEEKLY] {HOSTNAME} — {running}/{len(containers)} containers UP | {WEEK_AGO.strftime('%m/%d')}-{NOW.strftime('%m/%d')}"

    send_email(subject, html)


if __name__ == "__main__":
    main()
