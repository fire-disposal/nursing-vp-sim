#!/usr/bin/env python3
"""
Daily report — fetches /api/metrics from prod & staging backends,
generates an HTML email with visual charts, sends at 21:00 via cron.

Cron: 0 21 * * * cd /opt/monitor && python3 daily_report.py
"""

import json
import logging
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

ENV = {
    "prod":    {"label": "正式服", "url": "http://localhost:9001"},
    "staging": {"label": "测试服", "url": "http://localhost:9081"},
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def run(cmd: str, timeout: int = 15) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except Exception:
        return -1, ""


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


def dur(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    h, m = int(seconds // 3600), int((seconds % 3600) // 60)
    return f"{h}h {m}m" if h else f"{m}m"


def tag(online: bool) -> str:
    return '<span class="t-ok">● 在线</span>' if online else '<span class="t-err">● 离线</span>'


def bar(pct: float, cls: str = "") -> str:
    return f'<div class="bar"><div class="bar-fill {cls}" style="width:{min(pct,100):.1f}%"></div></div>'


def metric_box(val: str, label: str, sub: str = "", pct: float | None = None) -> str:
    bar_html = bar(pct) if pct is not None else ""
    sub_html = f'<div class="m-sub">{sub}</div>' if sub else ""
    return f'<div class="m-box"><div class="m-val">{val}</div><div class="m-lbl">{label}</div>{sub_html}{bar_html}</div>'


# ── Report builder ────────────────────────────────────────────────────────────

def build_report() -> str:
    now = datetime.now()
    date_str, time_str = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")

    data: dict[str, dict[str, Any]] = {}
    for key, cfg in ENV.items():
        h = fetch_health(cfg["url"])
        m = fetch_metrics(cfg["url"])
        data[key] = {"online": h is not None, "version": h.get("version", "?") if h else "?", "m": m}

    p, s = data["prod"], data["staging"]
    pm, sm = p["m"] or {}, s["m"] or {}
    has_metrics = bool(pm or sm)

    # ── Top metric boxes ──
    pr = pm.get("requests", {})
    sr = sm.get("requests", {})
    pl = pm.get("llm", {})
    sl = sm.get("llm", {})

    req_p, req_s = pr.get("total", 0), sr.get("total", 0)
    err_p = pr.get("by_status", {}).get("5xx", 0)
    err_s = sr.get("by_status", {}).get("5xx", 0)
    err_rate_p = err_p / req_p * 100 if req_p else 0
    err_rate_s = err_s / req_s * 100 if req_s else 0
    llm_p, llm_s = pl.get("calls_total", 0), sl.get("calls_total", 0)
    llm_err_p, llm_err_s = pl.get("calls_error", 0), sl.get("calls_error", 0)
    llm_sr_p = (llm_p - llm_err_p) / llm_p * 100 if llm_p else 100
    llm_sr_s = (llm_s - llm_err_s) / llm_s * 100 if llm_s else 100

    top = f"""
    <div class="row">
      {metric_box(f'{req_p:,}', '正式服请求', sub=f'错误率 {err_rate_p:.1f}%')}
      {metric_box(f'{llm_p:,}', '正式服 LLM', sub=f'成功率 {llm_sr_p:.1f}%')}
      {metric_box(f'{req_s:,}', '测试服请求', sub=f'错误率 {err_rate_s:.1f}%')}
      {metric_box(f'{llm_s:,}', '测试服 LLM', sub=f'成功率 {llm_sr_s:.1f}%')}
    </div>"""

    # ── Overview ──
    up = dur(pm.get("uptime_seconds", 0))
    us = dur(sm.get("uptime_seconds", 0))
    overview = f"""
    <div class="card">
      <h2>运行概况</h2>
      <table>
        <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
        <tr><td>状态</td><td class="r">{tag(p['online'])}</td><td class="r">{tag(s['online'])}</td></tr>
        <tr><td>版本</td><td class="r"><code>{p['version']}</code></td><td class="r"><code>{s['version']}</code></td></tr>
        <tr><td>运行时长</td><td class="r">{up}</td><td class="r">{us}</td></tr>
      </table>
    </div>"""

    # ── Requests ──
    reqs = ""
    if has_metrics:
        by_p = pr.get("by_status", {})
        by_s = sr.get("by_status", {})
        max_r = max(req_p, req_s, 1)

        chart = ""
        for label, code, cls in [("2xx", "2xx", "b-ok"), ("4xx", "4xx", "b-warn"), ("5xx", "5xx", "b-err")]:
            vp = by_p.get(code, 0)
            vs = by_s.get(code, 0)
            pct_p, pct_s = vp / max_r * 100, vs / max_r * 100
            chart += (
                f'<div class="chart-row">'
                f'<span class="chart-label">{label}</span>'
                f'<div class="chart-col"><span class="chart-env">P</span> {bar(pct_p, cls)} <span class="chart-num">{vp:,}</span></div>'
                f'<div class="chart-col"><span class="chart-env">S</span> {bar(pct_s, cls)} <span class="chart-num">{vs:,}</span></div>'
                f'</div>'
            )

        lat_p, lat_s = pr.get("latency_ms", {}), sr.get("latency_ms", {})
        reqs = f"""
        <div class="card">
          <h2>请求统计 &middot; <span style="font-weight:400;font-size:12px;color:var(--c-dim)">累计 {req_p:,} / {req_s:,}</span></h2>
          {chart}
          <div style="margin-top:20px">
            <h3>延迟 (ms)</h3>
            <table>
              <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
              <tr><td>P50</td><td class="r">{lat_p.get('p50','-')}</td><td class="r">{lat_s.get('p50','-')}</td></tr>
              <tr><td>P95</td><td class="r">{lat_p.get('p95','-')}</td><td class="r">{lat_s.get('p95','-')}</td></tr>
              <tr><td>P99</td><td class="r">{lat_p.get('p99','-')}</td><td class="r">{lat_s.get('p99','-')}</td></tr>
              <tr><td>Avg</td><td class="r">{lat_p.get('avg','-')}</td><td class="r">{lat_s.get('avg','-')}</td></tr>
            </table>
          </div>
        </div>"""
    else:
        reqs = '<div class="card"><h2>请求统计</h2><div class="dim">/api/metrics 端点暂不可用 — 数据将在端点部署后显示</div></div>'

    # ── LLM ──
    llm_section = ""
    if has_metrics and (llm_p or llm_s):
        costs = f"¥{pl.get('estimated_cost', 0):.2f} / ¥{sl.get('estimated_cost', 0):.2f}"
        tokens = f"{pl.get('tokens_used', 0):,} / {sl.get('tokens_used', 0):,}"
        llat_p, llat_s = pl.get("latency_ms", {}), sl.get("latency_ms", {})

        degraded = ""
        dp, ds = pl.get("degraded_providers", 0), sl.get("degraded_providers", 0)
        gp, gs = pl.get("global_degraded", False), sl.get("global_degraded", False)
        if dp or ds or gp or gs:
            parts = []
            if dp: parts.append(f"正式服: {dp} provider 降级")
            if ds: parts.append(f"测试服: {ds} provider 降级")
            if gp: parts.append("正式服 LLM 全局降级")
            if gs: parts.append("测试服 LLM 全局降级")
            degraded = f'<div class="alert">{"; ".join(parts)}</div>'

        llm_section = f"""
        <div class="card">
          <h2>LLM 调用</h2>
          <table>
            <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
            <tr><td>总调用</td><td class="r">{llm_p:,}</td><td class="r">{llm_s:,}</td></tr>
            <tr><td>成功</td><td class="r c-ok">{pl.get('calls_success',0):,}</td><td class="r c-ok">{sl.get('calls_success',0):,}</td></tr>
            <tr><td>失败</td><td class="r c-err">{llm_err_p:,}</td><td class="r c-err">{llm_err_s:,}</td></tr>
            <tr><td>成功率</td><td class="r" style="color:{_sr_c(llm_sr_p)}">{llm_sr_p:.1f}%</td><td class="r" style="color:{_sr_c(llm_sr_s)}">{llm_sr_s:.1f}%</td></tr>
          </table>
          <div class="row" style="margin-top:16px">
            {metric_box(tokens.split('/')[0].strip(), '正式服 Token', sub='累计')}
            {metric_box(costs.split('/')[0].strip(), '正式服费用', sub='CNY')}
            {metric_box(llat_p.get('avg','-')+'ms', '正式服延迟', sub='平均 LLM')}
          </div>
          <div class="row" style="margin-top:8px">
            {metric_box(tokens.split('/')[1].strip() if '/' in tokens else '-', '测试服 Token', sub='累计')}
            {metric_box(costs.split('/')[1].strip() if '/' in costs else '-', '测试服费用', sub='CNY')}
            {metric_box(llat_s.get('avg','-')+'ms', '测试服延迟', sub='平均 LLM')}
          </div>
          {degraded}
        </div>"""
    else:
        llm_section = '<div class="card"><h2>LLM 调用</h2><div class="dim">暂无 LLM 调用数据</div></div>'

    # ── Resources ──
    act_p, act_s = pm.get("active_sessions", 0), sm.get("active_sessions", 0)
    mem_p, mem_s = pm.get("memory_mb", 0), sm.get("memory_mb", 0)
    qp, qs = pm.get("queue", {}), sm.get("queue", {})
    dbp, dbs = pm.get("db", {}), sm.get("db", {})

    # Calc DB pool usage %
    db_pct_p = dbp.get("checked_out", 0) / dbp["pool_size"] * 100 if dbp and dbp.get("pool_size") else 0
    db_pct_s = dbs.get("checked_out", 0) / dbs["pool_size"] * 100 if dbs and dbs.get("pool_size") else 0

    res = f"""
    <div class="card">
      <h2>系统资源</h2>
      <div class="row">
        {metric_box(str(act_p), '正式服会话', sub='活跃中')}
        {metric_box(str(act_s), '测试服会话', sub='活跃中')}
        {metric_box(f'{mem_p:.0f} MB', '正式服内存', sub='进程 RSS')}
        {metric_box(f'{mem_s:.0f} MB', '测试服内存', sub='进程 RSS')}
      </div>
      <div class="row" style="margin-top:8px">
        {metric_box(str(qp.get('task_queue','-')), '任务队列', sub='正式服')}
        {metric_box(str(qs.get('task_queue','-')), '任务队列', sub='测试服')}
        {metric_box(str(qp.get('log_queue','-')), '日志队列', sub='正式服')}
        {metric_box(str(qs.get('log_queue','-')), '日志队列', sub='测试服')}
      </div>
    """

    if dbp or dbs:
        db_table = f"""
        <div style="margin-top:16px">
          <h3>DB 连接池</h3>
          <table>
            <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
            <tr><td>池大小</td><td class="r">{dbp.get('pool_size','-')}</td><td class="r">{dbs.get('pool_size','-')}</td></tr>
            <tr><td>使用中</td><td class="r">{dbp.get('checked_out','-')}</td><td class="r">{dbs.get('checked_out','-')}</td></tr>
            <tr><td>使用率</td><td class="r">{_db_usage_bar(db_pct_p)}</td><td class="r">{_db_usage_bar(db_pct_s)}</td></tr>
            <tr><td>溢出</td><td class="r">{dbp.get('overflow','-')}</td><td class="r">{dbs.get('overflow','-')}</td></tr>
          </table>
        </div>"""
        res += db_table

    if not has_metrics:
        res += '<div class="dim" style="margin-top:12px">/api/metrics 端点暂不可用</div>'

    res += "</div>"

    return WRAPPER.replace("{date}", date_str).replace("{time}", time_str).replace("{top}", top).replace("{overview}", overview).replace("{reqs}", reqs).replace("{llm}", llm_section).replace("{res}", res)


def _sr_c(pct: float) -> str:
    if pct >= 95: return "var(--c-ok)"
    if pct >= 80: return "var(--c-warn)"
    return "var(--c-err)"


def _db_usage_bar(pct: float) -> str:
    if pct == 0: return "-"
    cls = "b-ok" if pct < 60 else "b-warn" if pct < 80 else "b-err"
    return f'{pct:.0f}% {bar(pct, cls)}'


# ── CSS ───────────────────────────────────────────────────────────────────────

CSS = """
:root{color-scheme:light dark;--c-bg:#f8f9fa;--c-card:#fff;--c-card-bd:#e2e8f0;--c-txt:#1e293b;--c-dim:#94a3b8;--c-sub:#64748b;--c-ok:#059669;--c-warn:#d97706;--c-err:#dc2626;--c-accent:#2563eb}
@media (prefers-color-scheme:dark){
  :root{--c-bg:#0f1117;--c-card:#161b22;--c-card-bd:#21262d;--c-txt:#c9d1d9;--c-dim:#8b949e;--c-sub:#6e7681;--c-ok:#3fb950;--c-warn:#d29922;--c-err:#f85149;--c-accent:#58a6ff}
}
body{margin:0;padding:24px;background:var(--c-bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:var(--c-txt);line-height:1.5}
.container{max-width:720px;margin:0 auto}
.header{padding:16px 0 24px;border-bottom:2px solid var(--c-card-bd)}
.header h1{font-size:20px;font-weight:700;margin:0;color:var(--c-accent)}
.header .sub{font-size:12px;color:var(--c-dim);margin-top:4px}
.card{background:var(--c-card);border:1px solid var(--c-card-bd);border-radius:8px;padding:20px 24px;margin-top:16px}
.card h2{font-size:13px;font-weight:600;margin:0 0 16px;color:var(--c-sub);text-transform:uppercase;letter-spacing:.5px}
.card h3{font-size:11px;font-weight:600;margin:0 0 8px;color:var(--c-dim);text-transform:uppercase;letter-spacing:.5px}
.row{display:flex;flex-wrap:wrap;gap:12px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;border-bottom:2px solid var(--c-card-bd);font-size:11px;font-weight:600;color:var(--c-dim);text-transform:uppercase;letter-spacing:.5px}
td{padding:8px 10px;border-bottom:1px solid var(--c-card-bd)}td.r{text-align:right}
tr:last-child td{border-bottom:none}
code{background:var(--c-bg);padding:1px 6px;border-radius:3px;font-size:12px;border:1px solid var(--c-card-bd)}
.m-box{flex:1;min-width:130px;padding:16px;background:var(--c-bg);border-radius:6px;text-align:center}
.m-val{font-size:22px;font-weight:700;color:var(--c-accent)}
.m-lbl{font-size:11px;color:var(--c-dim);margin-top:4px}
.m-sub{font-size:11px;color:var(--c-sub);margin-top:2px}
.bar{height:6px;background:var(--c-card-bd);border-radius:3px;margin-top:8px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px;transition:width .4s;background:var(--c-accent)}
.b-ok{background:var(--c-ok)}.b-warn{background:var(--c-warn)}.b-err{background:var(--c-err)}
.t-ok{font-size:12px;color:var(--c-ok)}.t-err{font-size:12px;color:var(--c-err)}
.c-ok{color:var(--c-ok)}.c-err{color:var(--c-err)}
.alert{margin-top:12px;padding:8px 12px;background:rgba(248,81,73,0.08);border:1px solid rgba(248,81,73,0.2);border-radius:6px;font-size:12px;color:var(--c-err)}
.dim{font-size:13px;color:var(--c-dim);font-style:italic;padding:8px 0}
.footer{margin-top:20px;text-align:center;font-size:11px;color:var(--c-dim)}
.chart-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.chart-label{width:32px;font-size:11px;font-weight:600;color:var(--c-sub);text-align:right;flex-shrink:0}
.chart-col{flex:1;display:flex;align-items:center;gap:6px}
.chart-col .bar{flex:1;margin-top:0}
.chart-env{font-size:9px;font-weight:700;color:var(--c-dim);width:14px;text-align:center;flex-shrink:0}
.chart-num{font-size:11px;color:var(--c-sub);width:48px;text-align:right;flex-shrink:0}
"""

WRAPPER = (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">'
    f'<style>{CSS}</style></head><body><div class="container">'
    '<div class="header"><h1>Nursing VP Sim · 每日运维报告</h1>'
    '<div class="sub">{date} · {time} · yecaoyun</div></div>'
    '{top}{overview}{reqs}{llm}{res}'
    '<div class="footer">由 daily_report.py 自动生成 · 每日 21:00 · 数据来自 /api/metrics</div>'
    '</div></body></html>'
)


# ── Email ─────────────────────────────────────────────────────────────────────

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
            log.error("SMTP not configured")
            return False

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = mail_from
        msg["To"] = ", ".join(mail_to)
        msg.attach(MIMEText(body_html, "html", "utf-8"))

        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as srv:
            srv.ehlo()
            srv.starttls()
            srv.ehlo()
            srv.login(smtp_user, smtp_pass)
            srv.sendmail(mail_from, mail_to, msg.as_string())

        log.info("Report sent: %s", subject)
        return True
    except Exception as e:
        log.error("Email failed: %s", e)
        return False


def main():
    now = datetime.now()
    subject = f"Nursing VP Sim 每日报告 — {now.strftime('%Y-%m-%d')}"

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
