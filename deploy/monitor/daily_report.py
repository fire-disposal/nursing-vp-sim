#!/usr/bin/env python3
"""Daily report — fetches /api/metrics from prod & staging backends.

Cron: 0 9 * * * cd /opt/monitor && python3 daily_report.py
Generates an HTML email with visual charts."""

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

ENV: dict[str, dict[str, str]] = {
    "prod":    {"label": "正式服", "url": "http://localhost:9001"},
    "staging": {"label": "测试服", "url": "http://localhost:9081"},
}


def run(cmd: str, timeout: int = 15) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except Exception:
        return -1, ""


def _unwrap(raw: dict) -> dict:
    data = raw.get("data")
    return data if isinstance(data, dict) else raw


def fetch_health(base_url: str) -> dict | None:
    rc, out = run(f"curl -sS -m 10 '{base_url}/api/health'")
    if rc != 0:
        return None
    try:
        return _unwrap(json.loads(out))
    except json.JSONDecodeError:
        return None


def fetch_metrics(base_url: str) -> dict | None:
    rc, out = run(f"curl -sS -m 10 '{base_url}/api/metrics'")
    if rc != 0:
        return None
    try:
        return _unwrap(json.loads(out))
    except json.JSONDecodeError:
        return None


def dur(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    h, m = int(seconds // 3600), int((seconds % 3600) // 60)
    return f"{h}h {m}m" if h else f"{m}m"


def tag(label: str, cls: str) -> str:
    return f'<span class="tag {cls}">{label}</span>'


def bar(pct: float, cls: str = "") -> str:
    v = min(pct, 100)
    c = cls if cls else "bar-blue"
    return f'<div class="bar-wrap"><div class="bar-fill {c}" style="width:{v:.1f}%"></div></div>'


def metric(val: str, lbl: str, sub: str = "", pct: float | None = None, trend: str = "") -> str:
    bar_html = bar(pct) if pct is not None else ""
    sub_html = f'<div class="m-sub">{sub}</div>' if sub else ""
    trend_html = f'<div class="m-trend">{trend}</div>' if trend else ""
    return f'<div class="metric"><div class="m-val">{val}</div><div class="m-lbl">{lbl}</div>{trend_html}{sub_html}{bar_html}</div>'


def sr_color(pct: float) -> str:
    if pct >= 95:
        return "color:#22c55e"
    if pct >= 80:
        return "color:#f59e0b"
    return "color:#ef4444"


def _db_bar(pct: float) -> str:
    if pct == 0:
        return "-"
    cls = "bar-green" if pct < 60 else "bar-amber" if pct < 80 else "bar-red"
    return f'{pct:.0f}% {bar(pct, cls)}'


def build_report() -> str:
    now = datetime.now()
    date_str, time_str = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")

    data: dict[str, dict[str, Any]] = {}
    for key, cfg in ENV.items():
        h = fetch_health(cfg["url"])
        m = fetch_metrics(cfg["url"])
        data[key] = {
            "online": h is not None,
            "version": h.get("version", "?") if h else "?",
            "m": m,
        }

    prod = data["prod"]
    stag = data["staging"]
    pm = prod["m"] or {}
    sm = stag["m"] or {}
    has_metrics = bool(pm or sm)

    pr = pm.get("requests", {})
    sr = sm.get("requests", {})
    pl = pm.get("llm", {})
    sl = sm.get("llm", {})

    req_p = pr.get("total", 0)
    req_s = sr.get("total", 0)
    err_p = pr.get("by_status", {}).get("5xx", 0)
    err_s = sr.get("by_status", {}).get("5xx", 0)
    err_r_p = err_p / req_p * 100 if req_p else 0
    err_r_s = err_s / req_s * 100 if req_s else 0
    llm_p = pl.get("calls_total", 0)
    llm_s = sl.get("calls_total", 0)
    llm_ok_p = pl.get("calls_success", 0)
    llm_ok_s = sl.get("calls_success", 0)
    llm_err_p = pl.get("calls_error", 0)
    llm_err_s = sl.get("calls_error", 0)
    llm_sr_p = (llm_p - llm_err_p) / llm_p * 100 if llm_p else 100
    llm_sr_s = (llm_s - llm_err_s) / llm_s * 100 if llm_s else 100

    # ── Header ──
    header = f"""
<div class="header">
  <h1>Nursing VP Sim <span>每日运维报告</span></h1>
  <div class="h-sub">{date_str} &middot; {time_str} &middot; yecaoyun</div>
</div>"""

    # ── Overview ──
    up = dur(pm.get("uptime_seconds", 0))
    us = dur(sm.get("uptime_seconds", 0))
    overview = f"""
<div class="card">
  <h2>运行概况</h2>
  <table>
    <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
    <tr><td>状态</td><td class="r">{tag("● 在线", 'tag-ok') if prod['online'] else tag('● 离线', 'tag-err')}</td><td class="r">{tag("● 在线", 'tag-ok') if stag['online'] else tag('● 离线', 'tag-err')}</td></tr>
    <tr><td>版本</td><td class="r"><code>{prod['version']}</code></td><td class="r"><code>{stag['version']}</code></td></tr>
    <tr><td>运行时长</td><td class="r">{up}</td><td class="r">{us}</td></tr>
  </table>
</div>"""

    # ── Top metrics ──
    top = f"""
<div class="card">
  <h2>核心指标</h2>
  <div class="m-row">
    {metric(f'{req_p:,}', '正式服 请求', sub=f'错误率 {err_r_p:.1f}%')}
    {metric(f'{req_s:,}', '测试服 请求', sub=f'错误率 {err_r_s:.1f}%')}
    {metric(f'{llm_p:,}', '正式服 LLM', sub=f'成功率 {llm_sr_p:.1f}%')}
    {metric(f'{llm_s:,}', '测试服 LLM', sub=f'成功率 {llm_sr_s:.1f}%')}
  </div>
</div>"""

    # ── Requests ──
    reqs = ""
    if has_metrics:
        by_p, by_s = pr.get("by_status", {}), sr.get("by_status", {})
        max_r = max(req_p, req_s, 1)
        chart_rows = ""
        for label, code, cls in [("2xx 成功", "2xx", "bar-green"), ("4xx 客户端", "4xx", "bar-amber"), ("5xx 服务端", "5xx", "bar-red")]:
            vp, vs = by_p.get(code, 0), by_s.get(code, 0)
            chart_rows += (
                f'<div class="ch-row">'
                f'<span class="ch-lbl">{label}</span>'
                f'<div class="ch-col"><span class="ch-env">P</span>{bar(vp/max_r*100, cls)}<span class="ch-num">{vp:,}</span></div>'
                f'<div class="ch-col"><span class="ch-env">S</span>{bar(vs/max_r*100, cls)}<span class="ch-num">{vs:,}</span></div>'
                f'</div>'
            )
        lat_p, lat_s = pr.get("latency_ms", {}), sr.get("latency_ms", {})
        reqs = f"""
<div class="card">
  <h2>请求统计 · <span style="font-weight:400;font-size:11px;color:var(--c-dim)">累计 {req_p:,} / {req_s:,}</span></h2>
  {chart_rows}
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
        reqs = '<div class="card"><h2>请求统计</h2><div class="dim">/api/metrics 暂不可用</div></div>'

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

        tp, ts = tokens.split("/")
        cp, cs = costs.split("/")
        llm_section = f"""
<div class="card">
  <h2>LLM 调用</h2>
  <table>
    <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
    <tr><td>总调用</td><td class="r">{llm_p:,}</td><td class="r">{llm_s:,}</td></tr>
    <tr><td>成功</td><td class="r" style="color:#22c55e">{llm_ok_p:,}</td><td class="r" style="color:#22c55e">{llm_ok_s:,}</td></tr>
    <tr><td>失败</td><td class="r" style="color:#ef4444">{llm_err_p:,}</td><td class="r" style="color:#ef4444">{llm_err_s:,}</td></tr>
    <tr><td>成功率</td><td class="r" style="{sr_color(llm_sr_p)};font-weight:600">{llm_sr_p:.1f}%</td><td class="r" style="{sr_color(llm_sr_s)};font-weight:600">{llm_sr_s:.1f}%</td></tr>
  </table>
  <div class="m-row" style="margin-top:16px">
    {metric(tp.strip(), '正式服 Token', sub='累计')}
    {metric(cp.strip(), '正式服 费用', sub='CNY')}
    {metric(llat_p.get('avg','-')+'ms', '正式服 延迟', sub='平均 LLM')}
  </div>
  <div class="m-row" style="margin-top:10px">
    {metric(ts.strip() if '/' in tokens else '-', '测试服 Token', sub='累计')}
    {metric(cs.strip() if '/' in costs else '-', '测试服 费用', sub='CNY')}
    {metric(llat_s.get('avg','-')+'ms', '测试服 延迟', sub='平均 LLM')}
  </div>
  {degraded}
</div>"""
    else:
        llm_section = '<div class="card"><h2>LLM 调用</h2><div class="dim">暂无数据</div></div>'

    # ── Resources ──
    act_p, act_s = pm.get("active_sessions", 0), sm.get("active_sessions", 0)
    mem_p, mem_s = pm.get("memory_mb", 0), sm.get("memory_mb", 0)
    qp, qs = pm.get("queue", {}), sm.get("queue", {})
    dbp, dbs = pm.get("db", {}), sm.get("db", {})
    db_pct_p = dbp.get("checked_out", 0) / dbp["pool_size"] * 100 if dbp and dbp.get("pool_size") else 0
    db_pct_s = dbs.get("checked_out", 0) / dbs["pool_size"] * 100 if dbs and dbs.get("pool_size") else 0

    res_content = f"""
<div class="card">
  <h2>系统资源</h2>
  <div class="m-row">
    {metric(str(act_p), '正式服 会话', sub='活跃中')}
    {metric(str(act_s), '测试服 会话', sub='活跃中')}
    {metric(f'{mem_p:.0f} MB', '正式服 内存', sub='进程 RSS')}
    {metric(f'{mem_s:.0f} MB', '测试服 内存', sub='进程 RSS')}
  </div>
  <div class="m-row" style="margin-top:10px">
    {metric(str(qp.get('task_queue','-')), '任务队列 P', sub='正式服')}
    {metric(str(qs.get('task_queue','-')), '任务队列 S', sub='测试服')}
    {metric(str(qp.get('log_queue','-')), '日志队列 P', sub='正式服')}
    {metric(str(qs.get('log_queue','-')), '日志队列 S', sub='测试服')}
  </div>"""

    if dbp or dbs:
        res_content += f"""
  <div style="margin-top:20px">
    <h3>DB 连接池</h3>
    <table>
      <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
      <tr><td>池大小</td><td class="r">{dbp.get('pool_size','-')}</td><td class="r">{dbs.get('pool_size','-')}</td></tr>
      <tr><td>使用中</td><td class="r">{dbp.get('checked_out','-')}</td><td class="r">{dbs.get('checked_out','-')}</td></tr>
      <tr><td>使用率</td><td class="r">{_db_bar(db_pct_p)}</td><td class="r">{_db_bar(db_pct_s)}</td></tr>
    </table>
  </div>"""

    if not has_metrics:
        res_content += '<div class="dim" style="margin-top:12px">/api/metrics 暂不可用</div>'

    res_content += "\n</div>"

    # ── Error / Alert summary ──
    errors: list[str] = []
    if err_p:
        errors.append(f"正式服 {err_p} 次 5xx 错误 ({err_r_p:.1f}%)")
    if err_s:
        errors.append(f"测试服 {err_s} 次 5xx 错误 ({err_r_s:.1f}%)")
    if llm_err_p:
        errors.append(f"正式服 {llm_err_p} 次 LLM 调用失败")
    if llm_err_s:
        errors.append(f"测试服 {llm_err_s} 次 LLM 调用失败")
    if pl.get("degraded_providers", 0):
        errors.append(f"正式服 {pl['degraded_providers']} 个 LLM provider 降级")
    if sl.get("degraded_providers", 0):
        errors.append(f"测试服 {sl['degraded_providers']} 个 LLM provider 降级")
    if pl.get("global_degraded"):
        errors.append("正式服 LLM 全局降级")
    if sl.get("global_degraded"):
        errors.append("测试服 LLM 全局降级")

    if errors:
        items = "".join(f"<li>{e}</li>" for e in errors)
        errlog = f"""
<div class="card">
  <h2 style="color:var(--c-err);border-color:rgba(239,68,68,.2)">异常摘要</h2>
  <ul class="err-list">{items}</ul>
</div>"""
    else:
        errlog = f"""
<div class="card">
  <h2 style="color:var(--c-ok);border-color:rgba(34,197,94,.2)">异常摘要</h2>
  <div style="color:var(--c-ok);font-size:13px;font-weight:500">当前运行正常，无异常</div>
</div>"""

    return WRAPPER.replace("{date}", date_str).replace("{time}", time_str).replace(
        "{header}", header
    ).replace("{overview}", overview).replace("{top}", top).replace(
        "{reqs}", reqs
    ).replace("{llm}", llm_section).replace("{res}", res_content).replace("{errlog}", errlog)


# ── CSS ──

CSS = """
:root{color-scheme:light dark;--c-bg:#f1f5f9;--c-card:#fff;--c-card-bd:#e2e8f0;--c-txt:#0f172a;--c-dim:#94a3b8;--c-sub:#64748b;--c-ok:#22c55e;--c-warn:#f59e0b;--c-err:#ef4444;--c-accent:#2563eb;--c-accent-lt:#eff6ff}
@media (prefers-color-scheme:dark){
:root{--c-bg:#020617;--c-card:#0f1729;--c-card-bd:#1e293b;--c-txt:#e2e8f0;--c-dim:#475569;--c-sub:#64748b;--c-ok:#22c55e;--c-warn:#f59e0b;--c-err:#ef4444;--c-accent:#3b82f6;--c-accent-lt:#0f1b2d}
}
body{margin:0;padding:28px;background:var(--c-bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:var(--c-txt);line-height:1.5}
.container{max-width:740px;margin:0 auto}
.header{padding:8px 0 28px;border-bottom:3px solid var(--c-accent)}
.header h1{font-size:22px;font-weight:800;margin:0;color:var(--c-txt);letter-spacing:-.3px}
.header h1 span{color:var(--c-accent)}
.h-sub{font-size:12px;color:var(--c-dim);margin-top:6px}
.card{background:var(--c-card);border:1px solid var(--c-card-bd);border-radius:12px;padding:20px 24px;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card h2{font-size:12px;font-weight:700;margin:0 0 16px;color:var(--c-sub);text-transform:uppercase;letter-spacing:.8px;padding-bottom:10px;border-bottom:1px solid var(--c-card-bd)}
.card h3{font-size:11px;font-weight:600;margin:0 0 10px;color:var(--c-dim);text-transform:uppercase;letter-spacing:.5px}
.m-row{display:flex;flex-wrap:wrap;gap:12px}
.metric{flex:1;min-width:140px;padding:16px 14px;background:var(--c-bg);border:1px solid var(--c-card-bd);border-radius:10px;text-align:center}
.m-val{font-size:22px;font-weight:800;color:var(--c-txt);letter-spacing:-.3px}
.m-lbl{font-size:10px;color:var(--c-dim);margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
.m-sub{font-size:11px;color:var(--c-sub);margin-top:2px}
.m-trend{font-size:11px;font-weight:600;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 12px;border-bottom:2px solid var(--c-card-bd);font-size:10px;font-weight:700;color:var(--c-dim);text-transform:uppercase;letter-spacing:.6px}
td{padding:10px 12px;border-bottom:1px solid var(--c-card-bd);font-size:13px}td.r{text-align:right}
tr:last-child td{border-bottom:none}
code{background:var(--c-accent-lt);color:var(--c-accent);padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;border:1px solid rgba(37,99,235,.1)}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.tag-ok{background:#ecfdf5;color:#059669}
.tag-err{background:#fef2f2;color:#dc2626}
.bar-wrap{height:7px;background:var(--c-card-bd);border-radius:4px;margin-top:6px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;transition:width .5s ease}
.bar-blue{background:linear-gradient(90deg,#3b82f6,#60a5fa)}
.bar-green{background:linear-gradient(90deg,#22c55e,#4ade80)}
.bar-amber{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
.bar-red{background:linear-gradient(90deg,#ef4444,#f87171)}
.alert{margin-top:12px;padding:10px 14px;border:1px solid rgba(239,68,68,.2);border-radius:8px;font-size:12px;color:var(--c-err);background:rgba(239,68,68,.04)}
.err-list{margin:0;padding:0 0 0 18px;font-size:13px;color:var(--c-txt)}
.err-list li{padding:3px 0}
.dim{font-size:13px;color:var(--c-dim);font-style:italic;padding:8px 0}
.footer{margin-top:24px;padding-top:16px;text-align:center;font-size:11px;color:var(--c-dim);border-top:1px solid var(--c-card-bd)}
.ch-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.ch-lbl{width:76px;font-size:11px;font-weight:600;color:var(--c-sub);text-align:right;flex-shrink:0}
.ch-col{flex:1;display:flex;align-items:center;gap:8px}
.ch-col .bar-wrap{flex:1;margin-top:0}
.ch-env{font-size:9px;font-weight:700;color:var(--c-dim);width:16px;text-align:center;flex-shrink:0;background:var(--c-bg);border-radius:3px;padding:1px 0}
.ch-num{font-size:11px;color:var(--c-sub);width:52px;text-align:right;flex-shrink:0;font-weight:600}
@media (prefers-color-scheme:dark){
.tag-ok{background:rgba(34,197,94,.12);color:#22c55e}
.tag-err{background:rgba(239,68,68,.12);color:#ef4444}
}
"""

WRAPPER = (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">'
    f'<style>{CSS}</style></head><body><div class="container">'
    '{header}{overview}{top}{errlog}{reqs}{llm}{res}'
    '<div class="footer">由 daily_report.py 自动生成 · 每日 09:00 · 数据来自 /api/metrics</div>'
    '</div></body></html>'
)


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
