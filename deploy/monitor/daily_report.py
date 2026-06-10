#!/usr/bin/env python3
"""
Daily report — fetches /api/metrics from prod & staging backends,
generates an HTML email with visual charts, sends at 21:00 via cron.

Cron: 0 21 * * * cd /opt/monitor && python3 daily_report.py
"""

import json
import logging
import os
import smtplib
import subprocess
import sys
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
LOG_FILE = SCRIPT_DIR / "daily_report.log"

sys.path.insert(0, str(SCRIPT_DIR))
try:
    from config import *  # noqa: F403
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler(sys.stderr)],
)
log = logging.getLogger("daily_report")

ENVIRONMENTS = {
    "prod": {
        "label": "正式服",
        "url": "http://localhost:9001",
    },
    "staging": {
        "label": "测试服",
        "url": "http://localhost:9081",
    },
}


def run(cmd: str, timeout: int = 15) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except subprocess.TimeoutExpired:
        return -1, ""
    except Exception as e:
        return -1, str(e)


def fetch_health(base_url: str) -> dict | None:
    rc, out = run(f"curl -sS -m 10 '{base_url}/api/health'")
    if rc != 0:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def fetch_metrics(base_url: str) -> dict | None:
    rc, out = run(f"curl -sS -m 10 '{base_url}/api/metrics'")
    if rc != 0:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


# ── HTML helpers ──

def bar(value: float, max_val: float, color: str = "#6366f1", label: str = "") -> str:
    pct = min(value / max_val * 100, 100) if max_val > 0 else 0
    inner = f"{label}" if label else f"{value:,.0f}"
    return (
        f'<div style="background:#1e293b;border-radius:4px;height:22px;margin:2px 0;position:relative;overflow:hidden">'
        f'<div style="background:{color};height:100%;width:{pct:.1f}%;border-radius:4px;transition:width .4s"></div>'
        f'<span style="position:absolute;left:8px;top:0;line-height:22px;font-size:11px;color:#e2e8f0">{inner}</span>'
        f'</div>'
    )


def health_badge(online: bool) -> str:
    if online:
        return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;margin-right:4px"></span> 在线'
    return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:4px"></span> 离线'


def pct_bar(value: float, max_val: float, warn: float = 80, crit: float = 95) -> str:
    pct = min(value / max_val * 100, 100) if max_val > 0 else 0
    color = "#22c55e"
    if pct >= crit:
        color = "#ef4444"
    elif pct >= warn:
        color = "#f59e0b"
    return bar(value, max_val, color, f"{pct:.0f}%")


def kv_row(label: str, value: str) -> str:
    return f'<tr><td style="color:#94a3b8;padding:3px 0">{label}</td><td style="text-align:right;font-weight:600;padding:3px 0">{value}</td></tr>'


def format_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m"


# ── Report builder ──

def build_report() -> str:
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M")

    env_data: dict[str, dict[str, Any]] = {}
    for key, cfg in ENVIRONMENTS.items():
        h = fetch_health(cfg["url"])
        m = fetch_metrics(cfg["url"])
        env_data[key] = {
            "label": cfg["label"],
            "online": h is not None,
            "version": h.get("version", "?") if h else "?",
            "metrics": m,
        }

    prod = env_data["prod"]
    staging = env_data["staging"]

    rows = ""

    # ── Section: Overview ──
    rows += f"""
    <div class="section">
      <h2>运行概况</h2>
      <table class="overview">
        <tr>
          <th></th>
          <th>正式服</th>
          <th>测试服</th>
        </tr>
        <tr>
          <td>状态</td>
          <td>{health_badge(prod['online'])}</td>
          <td>{health_badge(staging['online'])}</td>
        </tr>
        <tr>
          <td>版本</td>
          <td><code>{prod['version']}</code></td>
          <td><code>{staging['version']}</code></td>
        </tr>
    """

    # Uptime
    u_p = prod["metrics"].get("uptime_seconds", 0) if prod["metrics"] else 0
    u_s = staging["metrics"].get("uptime_seconds", 0) if staging["metrics"] else 0
    rows += f"""
        <tr><td>运行时长</td><td>{format_duration(u_p)}</td><td>{format_duration(u_s)}</td></tr>
      </table>
    </div>
    """

    # ── Section: Requests ──
    rows += '<div class="section"><h2>请求统计 (今日累计 / 延迟)</h2>'
    if prod["metrics"] or staging["metrics"]:
        req_p = prod["metrics"].get("requests", {}) if prod["metrics"] else {}
        req_s = staging["metrics"].get("requests", {}) if staging["metrics"] else {}
        total_p = req_p.get("total", 0)
        total_s = req_s.get("total", 0)
        max_r = max(total_p, total_s, 1)

        by_status_p = req_p.get("by_status", {})
        by_status_s = req_s.get("by_status", {})

        rows += f'<div style="margin-bottom:12px;font-size:12px;color:#94a3b8">累计请求 — 正式服: {total_p:,} | 测试服: {total_s:,}</div>'

        for label, code, color in [("2xx", "2xx", "#22c55e"), ("4xx", "4xx", "#f59e0b"), ("5xx", "5xx", "#ef4444")]:
            vp = by_status_p.get(code, 0)
            vs = by_status_s.get(code, 0)
            rows += f"""
            <div style="display:flex;gap:12px;margin-bottom:4px">
              <span style="font-size:11px;width:30px;color:#94a3b8;text-align:right">{label}</span>
              <div style="flex:1">Prod {bar(vp, max_r, color, f"{vp:,}")}</div>
              <div style="flex:1">Stag {bar(vs, max_r, color, f"{vs:,}")}</div>
            </div>"""

        lat_p = req_p.get("latency_ms", {})
        lat_s = req_s.get("latency_ms", {})
        rows += f"""
        <div style="margin-top:16px;font-size:12px;color:#94a3b8">延迟 (ms)</div>
        <table style="margin-top:8px;width:100%">
          <tr><th></th><th>正式服</th><th>测试服</th></tr>
          <tr><td>P50</td><td>{lat_p.get('p50','-')}</td><td>{lat_s.get('p50','-')}</td></tr>
          <tr><td>P95</td><td>{lat_p.get('p95','-')}</td><td>{lat_s.get('p95','-')}</td></tr>
          <tr><td>P99</td><td>{lat_p.get('p99','-')}</td><td>{lat_s.get('p99','-')}</td></tr>
          <tr><td>Avg</td><td>{lat_p.get('avg','-')}</td><td>{lat_s.get('avg','-')}</td></tr>
        </table>
        """
    else:
        rows += '<div style="color:#94a3b8;font-style:italic">无请求数据</div>'
    rows += "</div>"

    # ── Section: LLM ──
    rows += '<div class="section"><h2>LLM 调用</h2>'
    llm_p = prod["metrics"].get("llm", {}) if prod["metrics"] else {}
    llm_s = staging["metrics"].get("llm", {}) if staging["metrics"] else {}
    has_llm = bool(llm_p or llm_s)

    if has_llm:
        calls_p = llm_p.get("calls_total", 0)
        calls_s = llm_s.get("calls_total", 0)
        err_p = llm_p.get("calls_error", 0)
        err_s = llm_s.get("calls_error", 0)
        suc_p = llm_p.get("calls_success", 0)
        suc_s = llm_s.get("calls_success", 0)

        rows += f"""
        <table style="width:100%;margin-bottom:12px">
          <tr><th></th><th>正式服</th><th>测试服</th></tr>
          <tr><td>总调用</td><td>{calls_p:,}</td><td>{calls_s:,}</td></tr>
          <tr><td>成功</td><td style="color:#22c55e">{suc_p:,}</td><td style="color:#22c55e">{suc_s:,}</td></tr>
          <tr><td>失败</td><td style="color:#ef4444">{err_p:,}</td><td style="color:#ef4444">{err_s:,}</td></tr>
        """

        sr_p = suc_p / calls_p * 100 if calls_p > 0 else 0
        sr_s = suc_s / calls_s * 100 if calls_s > 0 else 0
        rows += f"""
          <tr><td>成功率</td><td style="color:{'#22c55e' if sr_p>=95 else '#f59e0b' if sr_p>=80 else '#ef4444'}">{sr_p:.1f}%</td><td style="color:{'#22c55e' if sr_s>=95 else '#f59e0b' if sr_s>=80 else '#ef4444'}">{sr_s:.1f}%</td></tr>
        </table>
        """

        tokens_p = llm_p.get("tokens_used", 0)
        tokens_s = llm_s.get("tokens_used", 0)
        cost_p = llm_p.get("estimated_cost", 0)
        cost_s = llm_s.get("estimated_cost", 0)
        degraded_p = llm_p.get("degraded_providers", 0)
        degraded_s = llm_s.get("degraded_providers", 0)
        llm_lat_p = llm_p.get("latency_ms", {})
        llm_lat_s = llm_s.get("latency_ms", {})

        rows += f"""
        <div style="display:flex;gap:24px;flex-wrap:wrap">
          <div>
            <span style="font-size:11px;color:#94a3b8">Token 用量</span>
            <div style="font-size:16px;font-weight:700">{tokens_p:,} / {tokens_s:,}</div>
          </div>
          <div>
            <span style="font-size:11px;color:#94a3b8">估计费用 (CNY)</span>
            <div style="font-size:16px;font-weight:700">¥{cost_p:.2f} / ¥{cost_s:.2f}</div>
          </div>
          <div>
            <span style="font-size:11px;color:#94a3b8">LLM 平均延迟</span>
            <div style="font-size:16px;font-weight:700">{llm_lat_p.get('avg','-')}ms / {llm_lat_s.get('avg','-')}ms</div>
          </div>
        </div>
        """
        if degraded_p or degraded_s:
            rows += f'<div style="margin-top:12px;color:#f59e0b;font-size:12px">⚠ Provider 降级 — 正式服: {degraded_p} | 测试服: {degraded_s}</div>'
        if llm_p.get("global_degraded") or llm_s.get("global_degraded"):
            gd = []
            if llm_p.get("global_degraded"):
                gd.append("正式服")
            if llm_s.get("global_degraded"):
                gd.append("测试服")
            rows += f'<div style="color:#ef4444;font-size:12px;font-weight:700">❌ LLM 全局降级: {", ".join(gd)}</div>'
    else:
        rows += '<div style="color:#94a3b8;font-style:italic">无 LLM 数据</div>'
    rows += "</div>"

    # ── Section: Resources ──
    rows += '<div class="section"><h2>系统资源</h2>'

    act_p = prod["metrics"].get("active_sessions", 0) if prod["metrics"] else 0
    act_s = staging["metrics"].get("active_sessions", 0) if staging["metrics"] else 0
    mem_p = prod["metrics"].get("memory_mb", 0) if prod["metrics"] else 0
    mem_s = staging["metrics"].get("memory_mb", 0) if staging["metrics"] else 0
    q_p = prod["metrics"].get("queue", {}) if prod["metrics"] else {}
    q_s = staging["metrics"].get("queue", {}) if staging["metrics"] else {}
    db_p = prod["metrics"].get("db", {}) if prod["metrics"] else {}
    db_s = staging["metrics"].get("db", {}) if staging["metrics"] else {}

    rows += f"""
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px">
      <div class="stat-box"><span>活跃会话</span><strong>{act_p} / {act_s}</strong></div>
      <div class="stat-box"><span>内存 (MB)</span><strong>{mem_p:.0f} / {mem_s:.0f}</strong></div>
      <div class="stat-box"><span>任务队列</span><strong>{q_p.get('task_queue','-')} / {q_s.get('task_queue','-')}</strong></div>
      <div class="stat-box"><span>日志队列</span><strong>{q_p.get('log_queue','-')} / {q_s.get('log_queue','-')}</strong></div>
    </div>
    """

    if db_p or db_s:
        rows += f"""
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px">DB 连接池</div>
        <table style="width:100%">
          <tr><th></th><th>正式服</th><th>测试服</th></tr>
          <tr><td>池大小</td><td>{db_p.get('pool_size','-')}</td><td>{db_s.get('pool_size','-')}</td></tr>
          <tr><td>使用中</td><td>{db_p.get('checked_out','-')}</td><td>{db_s.get('checked_out','-')}</td></tr>
          <tr><td>溢出</td><td>{db_p.get('overflow','-')}</td><td>{db_s.get('overflow','-')}</td></tr>
        </table>
        """

    if not prod["metrics"] and not staging["metrics"]:
        rows += '<div style="color:#94a3b8;font-style:italic">/api/metrics 端点不可用</div>'

    rows += "</div>"

    return (
        WRAPPER
        .replace("{date}", date_str)
        .replace("{time}", time_str)
        .replace("{content}", rows)
    )


CSS = """
*{margin:0;padding:0;box-sizing:border-box}
body{margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#e2e8f0;line-height:1.6}
.container{max-width:700px;margin:0 auto;padding:32px 24px}
.header{text-align:center;padding:40px 0 24px;border-bottom:1px solid #1e293b;margin-bottom:32px}
.header h1{font-size:24px;font-weight:800;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.header .sub{font-size:13px;color:#64748b;margin-top:8px}
.section{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px}
.section h2{font-size:15px;font-weight:700;color:#cbd5e1;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #334155}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:6px 8px;border-bottom:1px solid #334155;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px}
td{padding:6px 8px;border-bottom:1px solid #1e293b}
tr:last-child td{border-bottom:none}
code{background:#0f172a;padding:1px 6px;border-radius:3px;font-size:12px}
.stat-box{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px 16px;flex:1;min-width:120px;text-align:center}
.stat-box span{display:block;font-size:11px;color:#64748b;margin-bottom:4px}
.stat-box strong{font-size:18px;font-weight:800}
.footer{text-align:center;padding:24px;font-size:11px;color:#475569;border-top:1px solid #1e293b;margin-top:24px}
.overview td{padding:8px 10px}
"""

WRAPPER = """\
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
<style>""" + CSS + """</style></head>
<body>
<div class="container">
<div class="header">
  <h1>Nursing VP Sim · 每日运维报告</h1>
  <div class="sub">{date} &middot; {time} &middot; 自动生成</div>
</div>
{content}
<div class="footer">由 daily_report.py 自动生成 &middot; 每日 21:00 发送 &middot; 数据来自 /api/metrics</div>
</div></body></html>"""


def send_email(subject: str, body_html: str) -> bool:
    try:
        cfg = sys.modules.get("config", None)
        smtp_host = getattr(cfg, "SMTP_HOST", "")
        smtp_port = getattr(cfg, "SMTP_PORT", 587)
        smtp_user = getattr(cfg, "SMTP_USER", "")
        smtp_pass = getattr(cfg, "SMTP_PASS", "")
        mail_from = getattr(cfg, "MAIL_FROM", smtp_user)
        mail_to_raw = getattr(cfg, "MAIL_TO", smtp_user)
        mail_to = mail_to_raw if isinstance(mail_to_raw, list) else [mail_to_raw]

        if not smtp_host:
            log.error("SMTP not configured — skipping email")
            return False

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

        log.info("Report sent: %s", subject)
        return True
    except Exception as e:
        log.error("Email failed: %s", e)
        return False


def main():
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    subject = f"Nursing VP Sim 每日报告 — {date_str}"

    log.info("Building daily report...")
    try:
        body = build_report()
    except Exception as e:
        log.exception("Failed to build report")
        body = f"<p>报告生成失败: {e}</p>"

    send_email(subject, body)
    log.info("Daily report complete")


if __name__ == "__main__":
    main()
