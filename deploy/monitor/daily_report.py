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


# ── Formatting helpers ────────────────────────────────────────────────────────

def dur(seconds: float) -> str:
    seconds = float(seconds)
    if seconds < 60:
        return f"{seconds:.0f}s"
    h, m = int(seconds // 3600), int((seconds % 3600) // 60)
    return f"{h}h {m}m" if h else f"{m}m"


def _v(val: Any) -> str:
    if val is None:
        return "-"
    if isinstance(val, float):
        return f"{val:,.1f}" if val != int(val) else f"{int(val):,}"
    if isinstance(val, int):
        return f"{val:,}"
    return str(val)


def _tag(label: str, cls: str) -> str:
    return f'<span class="tag {cls}">{label}</span>'


def _color(val: float, green: float, amber: float, inverse: bool = False) -> str:
    if inverse:
        if val <= green:
            return "var(--c-ok)"
        if val <= amber:
            return "var(--c-warn)"
        return "var(--c-err)"
    if val >= green:
        return "var(--c-ok)"
    if val >= amber:
        return "var(--c-warn)"
    return "var(--c-err)"


def _td(val: str, color: str = "") -> str:
    style = f' style="color:{color};font-weight:600"' if color else ""
    return f"<td class='r'{style}>{val}</td>"


def _bar(pct: float, cls: str = "bar-blue") -> str:
    v = min(max(pct, 0), 100)
    return f'<div class="bar-wrap"><div class="bar-fill {cls}" style="width:{v:.1f}%"></div></div>'


def _bar_td(pct: float) -> str:
    if pct == 0:
        return "<td class='r'>-</td>"
    cls = "bar-green" if pct < 60 else ("bar-amber" if pct < 80 else "bar-red")
    color = _color(pct, 60, 80, inverse=True)
    return (
        f'<td class="r" style="color:{color};font-weight:600">'
        f'{pct:.0f}%{_bar(pct, cls)}</td>'
    )


# ── Report builder ────────────────────────────────────────────────────────────

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
    by_p = pr.get("by_status", {})
    by_s = sr.get("by_status", {})
    err5_p = by_p.get("5xx", 0)
    err5_s = by_s.get("5xx", 0)
    err4_p = by_p.get("4xx", 0)
    err4_s = by_s.get("4xx", 0)
    err_r_p = err5_p / req_p * 100 if req_p else 0
    err_r_s = err5_s / req_s * 100 if req_s else 0

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
  <div class="sub">{date_str} &middot; {time_str} &middot; yecaoyun</div>
</div>"""

    # ── Overview ──
    up_p = dur(pm.get("uptime_seconds", 0))
    up_s = dur(sm.get("uptime_seconds", 0))
    tag_p = _tag("● 在线", "tag-ok") if prod["online"] else _tag("● 离线", "tag-err")
    tag_s = _tag("● 在线", "tag-ok") if stag["online"] else _tag("● 离线", "tag-err")
    overview = f"""
<div class="card">
  <h2>运行概况</h2>
  <table>
    <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
    <tr><td>状态</td><td class="r">{tag_p}</td><td class="r">{tag_s}</td></tr>
    <tr><td>版本</td><td class="r"><code>{prod['version']}</code></td><td class="r"><code>{stag['version']}</code></td></tr>
    <tr><td>运行时长</td><td class="r">{up_p}</td><td class="r">{up_s}</td></tr>
  </table>
</div>"""

    # ── Requests ──
    if has_metrics:
        ok_p, ok_s = by_p.get("2xx", 0), by_s.get("2xx", 0)
        lat_p, lat_s = pr.get("latency_ms", {}), sr.get("latency_ms", {})
        max_r = max(req_p, req_s, 1)

        chart_rows = ""
        for label, code, cls in [
            ("2xx", "2xx", "bar-green"),
            ("4xx", "4xx", "bar-amber"),
            ("5xx", "5xx", "bar-red"),
        ]:
            vp, vs = by_p.get(code, 0), by_s.get(code, 0)
            chart_rows += (
                f'<div class="ch-row">'
                f'<span class="ch-lbl">{label}</span>'
                f'<div class="ch-col"><span class="ch-env">P</span>'
                f'{_bar(vp / max_r * 100, cls)}'
                f'<span class="ch-num">{vp:,}</span></div>'
                f'<div class="ch-col"><span class="ch-env">S</span>'
                f'{_bar(vs / max_r * 100, cls)}'
                f'<span class="ch-num">{vs:,}</span></div>'
                f'</div>'
            )

        reqs = f"""
<div class="card">
  <h2>请求统计</h2>
  <table>
    <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
    <tr><td>总请求</td><td class="r" style="font-weight:600">{req_p:,}</td><td class="r" style="font-weight:600">{req_s:,}</td></tr>
    <tr><td>2xx 成功</td>{_td(f'{ok_p:,}', 'var(--c-ok)')}{_td(f'{ok_s:,}', 'var(--c-ok)')}</tr>
    <tr><td>4xx 客户端</td>{_td(f'{err4_p:,}', 'var(--c-warn)' if err4_p else '')}{_td(f'{err4_s:,}', 'var(--c-warn)' if err4_s else '')}</tr>
    <tr><td>5xx 服务端</td>{_td(f'{err5_p:,}', 'var(--c-err)' if err5_p else '')}{_td(f'{err5_s:,}', 'var(--c-err)' if err5_s else '')}</tr>
    <tr><td>5xx 错误率</td>{_td(f'{err_r_p:.1f}%', _color(err_r_p, 1, 5, inverse=True))}{_td(f'{err_r_s:.1f}%', _color(err_r_s, 1, 5, inverse=True))}</tr>
  </table>

  <div class="sub-section">
    <h3>状态分布</h3>
    {chart_rows}
  </div>

  <div class="sub-section">
    <h3>延迟 (ms)</h3>
    <table>
      <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
      <tr><td>P50</td><td class="r">{_v(lat_p.get('p50'))}</td><td class="r">{_v(lat_s.get('p50'))}</td></tr>
      <tr><td>P95</td><td class="r">{_v(lat_p.get('p95'))}</td><td class="r">{_v(lat_s.get('p95'))}</td></tr>
      <tr><td>P99</td><td class="r">{_v(lat_p.get('p99'))}</td><td class="r">{_v(lat_s.get('p99'))}</td></tr>
      <tr><td>平均</td><td class="r">{_v(lat_p.get('avg'))}</td><td class="r">{_v(lat_s.get('avg'))}</td></tr>
    </table>
  </div>
</div>"""
    else:
        reqs = '<div class="card"><h2>请求统计</h2><div class="dim">/api/metrics 暂不可用</div></div>'

    # ── LLM ──
    if has_metrics and (llm_p or llm_s):
        cost_p = pl.get("estimated_cost", 0)
        cost_s = sl.get("estimated_cost", 0)
        tok_p = pl.get("tokens_used", 0)
        tok_s = sl.get("tokens_used", 0)
        llat_p = pl.get("latency_ms", {})
        llat_s = sl.get("latency_ms", {})

        degraded = ""
        dp = pl.get("degraded_providers", 0)
        ds = sl.get("degraded_providers", 0)
        gp = pl.get("global_degraded", False)
        gs = sl.get("global_degraded", False)
        if dp or ds or gp or gs:
            parts = []
            if dp:
                parts.append(f"正式服: {dp} provider 降级")
            if ds:
                parts.append(f"测试服: {ds} provider 降级")
            if gp:
                parts.append("正式服 LLM 全局降级")
            if gs:
                parts.append("测试服 LLM 全局降级")
            degraded = f'<div class="alert">{"; ".join(parts)}</div>'

        llm_section = f"""
<div class="card">
  <h2>LLM 调用</h2>
  <table>
    <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
    <tr><td>总调用</td><td class="r" style="font-weight:600">{llm_p:,}</td><td class="r" style="font-weight:600">{llm_s:,}</td></tr>
    <tr><td>成功</td>{_td(f'{llm_ok_p:,}', 'var(--c-ok)')}{_td(f'{llm_ok_s:,}', 'var(--c-ok)')}</tr>
    <tr><td>失败</td>{_td(f'{llm_err_p:,}', 'var(--c-err)' if llm_err_p else '')}{_td(f'{llm_err_s:,}', 'var(--c-err)' if llm_err_s else '')}</tr>
    <tr><td>成功率</td>{_td(f'{llm_sr_p:.1f}%', _color(llm_sr_p, 95, 80))}{_td(f'{llm_sr_s:.1f}%', _color(llm_sr_s, 95, 80))}</tr>
    <tr><td>Token 消耗</td><td class="r">{tok_p:,}</td><td class="r">{tok_s:,}</td></tr>
    <tr><td>预估费用</td><td class="r">¥{cost_p:.2f}</td><td class="r">¥{cost_s:.2f}</td></tr>
    <tr><td>平均延迟</td><td class="r">{_v(llat_p.get('avg'))} ms</td><td class="r">{_v(llat_s.get('avg'))} ms</td></tr>
    <tr><td>P95 延迟</td><td class="r">{_v(llat_p.get('p95'))} ms</td><td class="r">{_v(llat_s.get('p95'))} ms</td></tr>
  </table>
  {degraded}
</div>"""
    else:
        llm_section = '<div class="card"><h2>LLM 调用</h2><div class="dim">暂无数据</div></div>'

    # ── Resources ──
    act_p = pm.get("active_sessions", 0)
    act_s = sm.get("active_sessions", 0)
    mem_p = pm.get("memory_mb", 0)
    mem_s = sm.get("memory_mb", 0)
    qp = pm.get("queue", {})
    qs = sm.get("queue", {})
    dbp = pm.get("db", {})
    dbs = sm.get("db", {})
    db_pct_p = (
        dbp.get("checked_out", 0) / dbp["pool_size"] * 100
        if dbp and dbp.get("pool_size")
        else 0
    )
    db_pct_s = (
        dbs.get("checked_out", 0) / dbs["pool_size"] * 100
        if dbs and dbs.get("pool_size")
        else 0
    )

    res_section = f"""
<div class="card">
  <h2>系统资源</h2>
  <table>
    <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
    <tr><td>活跃会话</td><td class="r">{act_p}</td><td class="r">{act_s}</td></tr>
    <tr><td>进程内存</td><td class="r">{mem_p:.0f} MB</td><td class="r">{mem_s:.0f} MB</td></tr>
    <tr><td>任务队列</td><td class="r">{_v(qp.get('task_queue'))}</td><td class="r">{_v(qs.get('task_queue'))}</td></tr>
    <tr><td>日志队列</td><td class="r">{_v(qp.get('log_queue'))}</td><td class="r">{_v(qs.get('log_queue'))}</td></tr>
  </table>"""

    if dbp or dbs:
        res_section += f"""
  <div class="sub-section">
    <h3>DB 连接池</h3>
    <table>
      <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>
      <tr><td>池大小</td><td class="r">{_v(dbp.get('pool_size'))}</td><td class="r">{_v(dbs.get('pool_size'))}</td></tr>
      <tr><td>使用中</td><td class="r">{_v(dbp.get('checked_out'))}</td><td class="r">{_v(dbs.get('checked_out'))}</td></tr>
      <tr><td>使用率</td>{_bar_td(db_pct_p)}{_bar_td(db_pct_s)}</tr>
    </table>
  </div>"""

    if not has_metrics:
        res_section += '<div class="dim">/api/metrics 暂不可用</div>'

    res_section += "\n</div>"

    # ── Error / Alert summary ──
    errors: list[str] = []
    if err5_p:
        errors.append(f"正式服 {err5_p} 次 5xx 错误 ({err_r_p:.1f}%)")
    if err5_s:
        errors.append(f"测试服 {err5_s} 次 5xx 错误 ({err_r_s:.1f}%)")
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
  <h2 class="h-err">异常摘要</h2>
  <ul class="err-list">{items}</ul>
</div>"""
    else:
        errlog = """
<div class="card">
  <h2 class="h-ok">异常摘要</h2>
  <div class="status-ok">当前运行正常，无异常</div>
</div>"""

    return (
        WRAPPER
        .replace("__HEADER__", header)
        .replace("__OVERVIEW__", overview)
        .replace("__REQS__", reqs)
        .replace("__LLM__", llm_section)
        .replace("__RES__", res_section)
        .replace("__ERRLOG__", errlog)
    )


# ── CSS ───────────────────────────────────────────────────────────────────────

CSS = """\
:root{color-scheme:light dark}
:root{
  --c-bg:#f8f9fa;--c-card:#fff;--c-card-bd:#e2e8f0;
  --c-txt:#1e293b;--c-dim:#94a3b8;--c-sub:#64748b;
  --c-ok:#22c55e;--c-warn:#f59e0b;--c-err:#ef4444;
  --c-accent:#2563eb;--c-accent-lt:#eff6ff
}
@media(prefers-color-scheme:dark){:root{
  --c-bg:#0f1117;--c-card:#161b22;--c-card-bd:#21262d;
  --c-txt:#c9d1d9;--c-dim:#484f58;--c-sub:#8b949e;
  --c-ok:#3fb950;--c-warn:#d29922;--c-err:#f85149;
  --c-accent:#58a6ff;--c-accent-lt:#0d1117
}}
body{margin:0;padding:24px;background:var(--c-bg);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:14px;color:var(--c-txt);line-height:1.5}
.container{max-width:720px;margin:0 auto}
.header{padding:16px 0 24px;border-bottom:2px solid var(--c-accent)}
.header h1{font-size:20px;font-weight:700;margin:0;color:var(--c-accent)}
.header h1 span{font-weight:400;color:var(--c-sub)}
.header .sub{font-size:12px;color:var(--c-dim);margin-top:4px}
.card{background:var(--c-card);border:1px solid var(--c-card-bd);
  border-radius:8px;padding:20px 24px;margin-top:16px}
.card h2{font-size:13px;font-weight:600;margin:0 0 16px;color:var(--c-sub);
  text-transform:uppercase;letter-spacing:.5px;padding-bottom:10px;
  border-bottom:1px solid var(--c-card-bd)}
.card h3{font-size:11px;font-weight:600;margin:0 0 10px;color:var(--c-dim);
  text-transform:uppercase;letter-spacing:.5px}
.sub-section{margin-top:20px}
.h-err{color:var(--c-err) !important;border-bottom-color:rgba(239,68,68,.2) !important}
.h-ok{color:var(--c-ok) !important;border-bottom-color:rgba(34,197,94,.2) !important}
.status-ok{color:var(--c-ok);font-size:13px;font-weight:500}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;border-bottom:2px solid var(--c-card-bd);
  font-size:11px;font-weight:600;color:var(--c-dim);
  text-transform:uppercase;letter-spacing:.5px}
td{padding:8px 10px;border-bottom:1px solid var(--c-card-bd);font-size:13px}
td.r,th.r{text-align:right}
tr:last-child td{border-bottom:none}
code{background:var(--c-accent-lt);color:var(--c-accent);padding:2px 8px;
  border-radius:4px;font-size:12px;font-weight:600;
  border:1px solid rgba(37,99,235,.1)}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;
  font-size:11px;font-weight:600}
.tag-ok{background:rgba(34,197,94,.1);color:var(--c-ok)}
.tag-err{background:rgba(239,68,68,.1);color:var(--c-err)}
.bar-wrap{height:6px;background:var(--c-card-bd);border-radius:3px;
  margin-top:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px}
.bar-blue{background:linear-gradient(90deg,#3b82f6,#60a5fa)}
.bar-green{background:linear-gradient(90deg,#22c55e,#4ade80)}
.bar-amber{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
.bar-red{background:linear-gradient(90deg,#ef4444,#f87171)}
.alert{margin-top:12px;padding:10px 14px;border:1px solid rgba(239,68,68,.2);
  border-radius:6px;font-size:12px;color:var(--c-err);
  background:rgba(239,68,68,.04)}
.err-list{margin:0;padding:0 0 0 18px;font-size:13px;color:var(--c-txt)}
.err-list li{padding:3px 0}
.dim{font-size:13px;color:var(--c-dim);font-style:italic;padding:8px 0}
.footer{margin-top:20px;text-align:center;font-size:11px;color:var(--c-dim)}
.ch-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.ch-lbl{width:32px;font-size:11px;font-weight:600;color:var(--c-sub);
  text-align:right;flex-shrink:0}
.ch-col{flex:1;display:flex;align-items:center;gap:8px}
.ch-col .bar-wrap{flex:1;margin-top:0}
.ch-env{font-size:9px;font-weight:700;color:var(--c-dim);width:14px;
  text-align:center;flex-shrink:0}
.ch-num{font-size:11px;color:var(--c-sub);width:52px;text-align:right;
  flex-shrink:0;font-weight:600}
"""

WRAPPER = (
    '<!DOCTYPE html><html><head><meta charset="utf-8">'
    '<meta name="color-scheme" content="light dark">'
    f"<style>{CSS}</style></head><body><div class='container'>"
    "__HEADER____OVERVIEW____ERRLOG____REQS____LLM____RES__"
    '<div class="footer">由 daily_report.py 自动生成 · 每日 09:00 · '
    "数据来自 /api/metrics</div></div></body></html>"
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
