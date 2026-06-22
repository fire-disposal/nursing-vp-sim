#!/usr/bin/env python3
"""Daily report — calls /api/ops/report and sends HTML email.

Cron: 0 9 * * * cd /opt/nursing-vp-sim/deploy/monitor && python3 daily_report.py
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

SCRIPT_DIR = Path(__file__).resolve().parent
LOG_FILE = SCRIPT_DIR / "daily_report.log"
CONFIG_FILE = SCRIPT_DIR / "config.py"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler(sys.stderr)],
)
log = logging.getLogger("daily_report")

sys.path.insert(0, str(SCRIPT_DIR))

# ── Config ────────────────────────────────────────────────────────────────────
sys.path.insert(0, str(SCRIPT_DIR))
from _env import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO, DIAGNOSE_TOKEN, HOSTNAME  # noqa: E402
from _env import _REPORT_PORTS as _ENV  # noqa: E402

_ENV_LABELS = {"prod": "正式服", "staging": "测试服"}

if not SMTP_HOST:
    log.warning("SMTP_HOST not configured, email disabled")


def fetch_report(port: int) -> dict | None:
    url = f"http://127.0.0.1:{port}/api/ops/report"
    if DIAGNOSE_TOKEN:
        url += f"?token={DIAGNOSE_TOKEN}"
    try:
        r = subprocess.run(
            ["curl", "-sS", "-m", "10", url],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode != 0:
            return None
        # /api/ops/report 已改为直接返回数据体（无 {"data": ...} 信封包装）
        data = json.loads(r.stdout)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


# ── HTML helpers ───────────────────────────────────────────────────────────────

def _card(title: str, cls: str = "") -> str:
    extra = f' class="{cls}"' if cls else ""
    return f'<div class="card"{extra}><h2>{title}</h2>'

def _td(val, color=""):
    style = f' style="color:{color};font-weight:600"' if color else ""
    return f'<td class="r"{style}>{val or "-"}</td>'

def _cmp(val, green, amber, inverse=False):
    if inverse:
        return "var(--c-ok)" if val <= green else ("var(--c-warn)" if val <= amber else "var(--c-err)")
    return "var(--c-ok)" if val >= green else ("var(--c-warn)" if val >= amber else "var(--c-err)")

def _pct(val):
    return f"{val:.1f}%" if val is not None else "-"


def build_report() -> str:
    now = datetime.now()
    date_str, time_str = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")

    data = {}
    online = {}
    for key, port in _ENV.items():
        rpt = fetch_report(port)
        data[key] = rpt
        online[key] = rpt is not None

    prod, stag = data.get("prod") or {}, data.get("staging") or {}

    # ── Header ──
    header = f"""<div class="header">
  <h1>Nursing VP Sim <span>每日运维报告</span></h1>
  <div class="sub">{date_str} &middot; {time_str} &middot; {HOSTNAME}</div>
</div>"""

    # ── Overview ──
    tags = {
        "prod": '<span class="tag tag-ok">● 在线</span>' if online["prod"] else '<span class="tag tag-err">● 离线</span>',
        "staging": '<span class="tag tag-ok">● 在线</span>' if online["staging"] else '<span class="tag tag-err">● 离线</span>',
    }
    overview = """<div class="card"><h2>运行概况</h2><table>
    <tr><th></th><th class="r">正式服</th><th class="r">测试服</th></tr>"""
    overview += f"<tr><td>状态</td><td class='r'>{tags['prod']}</td><td class='r'>{tags['staging']}</td></tr>"

    for label, key in [("运行时长", "uptime_hours")]:
        pv = prod.get("summary", {}).get(key, 0)
        sv = stag.get("summary", {}).get(key, 0)
        overview += f"<tr><td>{label}</td><td class='r'>{pv:.1f}h</td><td class='r'>{sv:.1f}h</td></tr>"

    overview += "</table></div>"

    # ── LLM ──
    pl = prod.get("llm", {})
    sl = stag.get("llm", {})
    llm_section = _card("LLM 调用") + "<table><tr><th></th><th class='r'>正式服</th><th class='r'>测试服</th></tr>"
    for label, key in [
        ("总调用(24h)", "total_calls_24h"), ("成功率", "success_rate"),
        ("错误数(24h)", "error_count_24h"), ("平均延迟(ms)", "avg_latency_ms"),
    ]:
        pv = pl.get(key)
        sv = sl.get(key)
        if key == "success_rate":
            llm_section += f"<tr><td>{label}</td>{_td(_pct(pv), _cmp(pv or 100, 95, 80))}{_td(_pct(sv), _cmp(sv or 100, 95, 80))}</tr>"
        elif key == "error_count_24h":
            llm_section += f"<tr><td>{label}</td>{_td(str(pv or 0), 'var(--c-err)' if pv else '')}{_td(str(sv or 0), 'var(--c-err)' if sv else '')}</tr>"
        else:
            llm_section += f"<tr><td>{label}</td>{_td(str(pv))}{_td(str(sv))}</tr>"

    # Top errors
    pe = pl.get("top_errors", [])
    se = sl.get("top_errors", [])
    if pe or se:
        llm_section += '<tr><td colspan="3" style="padding-top:8px;font-size:11px;color:var(--c-dim)">'
        if pe:
            llm_section += "正式服Top错误: " + ", ".join(f"{e['type']}({e['count']})" for e in pe[:3])
        if se:
            llm_section += " 测试服Top错误: " + ", ".join(f"{e['type']}({e['count']})" for e in se[:3])
        llm_section += "</td></tr>"
    llm_section += "</table></div>"

    # ── Voice (TTS/ASR) ──
    pv_voice = prod.get("voice", {})
    sv_voice = stag.get("voice", {})
    voice_section = _card("语音服务 (TTS/ASR)") + "<table><tr><th></th><th class='r'>正式服</th><th class='r'>测试服</th></tr>"
    for svc, sr_green, sr_amber in [("tts", 90, 75), ("asr", 80, 60)]:
        pt = pv_voice.get(svc, {})
        st = sv_voice.get(svc, {})
        name = svc.upper()
        pc = pt.get("calls_24h", 0)
        sc = st.get("calls_24h", 0)
        voice_section += f"<tr><td>{name} 调用(24h)</td>{_td(str(pc))}{_td(str(sc))}</tr>"
        psr, ssr = pt.get("success_rate"), st.get("success_rate")
        pcolor = _cmp(psr if psr is not None else 100, sr_green, sr_amber) if pc else ""
        scolor = _cmp(ssr if ssr is not None else 100, sr_green, sr_amber) if sc else ""
        voice_section += (
            f"<tr><td>{name} 成功率</td>"
            f"{_td(_pct(psr) if pc else '-', pcolor)}{_td(_pct(ssr) if sc else '-', scolor)}</tr>"
        )
        pe, se = pt.get("error_count_24h", 0), st.get("error_count_24h", 0)
        voice_section += (
            f"<tr><td>{name} 错误(24h)</td>"
            f"{_td(str(pe), 'var(--c-err)' if pe else '')}{_td(str(se), 'var(--c-err)' if se else '')}</tr>"
        )

    def _bcell(b: dict) -> str:
        budget = b.get("monthly_budget", 0)
        if not budget:
            return _td("-")
        pct = b.get("usage_pct", 0)
        return _td(
            f"¥{b.get('monthly_cost', 0):.2f}/{budget:.0f} ({pct:.0f}%)",
            _cmp(pct, 80, 100, inverse=True),
        )

    voice_section += f"<tr><td>本月语音成本</td>{_bcell(prod.get('voice_budget', {}))}{_bcell(stag.get('voice_budget', {}))}</tr>"
    voice_section += "</table></div>"


    # ── Scoring ──
    psc = prod.get("scoring", {})
    ssc = stag.get("scoring", {})
    scoring = _card("评分队列") + "<table><tr><th></th><th class='r'>正式服</th><th class='r'>测试服</th></tr>"
    scoring += f"<tr><td>待处理</td>{_td(str(psc.get('pending', 0)))}{_td(str(ssc.get('pending', 0)))}</tr>"
    scoring += f"<tr><td>卡住(&gt;24h)</td>{_td(str(psc.get('stuck', 0)), 'var(--c-err)' if psc.get('stuck') else '')}{_td(str(ssc.get('stuck', 0)), 'var(--c-err)' if ssc.get('stuck') else '')}</tr>"
    scoring += "</table></div>"

    # ── Sessions ──
    pse = prod.get("sessions", {})
    sse = stag.get("sessions", {})
    sessions = _card("活跃会话") + "<table><tr><th></th><th class='r'>正式服</th><th class='r'>测试服</th></tr>"
    sessions += f"<tr><td>进行中</td>{_td(str(pse.get('active', 0)))}{_td(str(sse.get('active', 0)))}</tr>"
    sessions += "</table></div>"

    # ── Alerts ──
    pa = prod.get("alerts", [])
    sa = stag.get("alerts", [])
    all_alerts = pa + sa
    if all_alerts:
        items = "".join(f"<li>{a}</li>" for a in all_alerts)
        errlog = _card("异常摘要", "h-err") + f'<ul class="err-list">{items}</ul></div>'
    else:
        errlog = _card("异常摘要", "h-ok") + '<div class="status-ok">当前运行正常，无异常</div></div>'

    return WRAPPER.replace("__HEADER__", header).replace("__OVERVIEW__", overview).replace("__LLM__", llm_section).replace("__VOICE__", voice_section).replace("__SCORING__", scoring).replace("__SESSIONS__", sessions).replace("__ERRLOG__", errlog)


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
.h-err{color:var(--c-err)!important;border-bottom-color:rgba(239,68,68,.2)!important}
.h-ok{color:var(--c-ok)!important;border-bottom-color:rgba(34,197,94,.2)!important}
.status-ok{color:var(--c-ok);font-size:13px;font-weight:500}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;border-bottom:2px solid var(--c-card-bd);
  font-size:11px;font-weight:600;color:var(--c-dim);text-transform:uppercase}
td{padding:8px 10px;border-bottom:1px solid var(--c-card-bd);font-size:13px}
td.r,th.r{text-align:right}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.tag-ok{background:rgba(34,197,94,.1);color:var(--c-ok)}
.tag-err{background:rgba(239,68,68,.1);color:var(--c-err)}
.err-list{margin:0;padding:0 0 0 18px;font-size:13px;color:var(--c-txt)}
.err-list li{padding:4px 0}
.footer{margin-top:20px;text-align:center;font-size:11px;color:var(--c-dim)}
"""

WRAPPER = (
    '<!DOCTYPE html><html><head><meta charset="utf-8">'
    '<meta name="color-scheme" content="light dark">'
    f"<style>{CSS}</style></head><body><div class='container'>"
    "__HEADER____OVERVIEW____ERRLOG____LLM____VOICE____SCORING____SESSIONS__"
    '<div class="footer">由 daily_report.py 自动生成 · 每日 09:00 · '
    "数据来自 /api/ops/report</div></div></body></html>"
)


def send_email(subject: str, body_html: str) -> bool:
    if not SMTP_HOST:
        log.warning("SMTP not configured")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = MAIL_FROM
        msg["To"] = ", ".join(MAIL_TO)
        msg.attach(MIMEText(body_html, "html", "utf-8"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as srv:
            srv.ehlo(); srv.starttls(); srv.ehlo()
            srv.login(SMTP_USER, SMTP_PASS)
            srv.sendmail(MAIL_FROM, MAIL_TO, msg.as_string())
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
    except Exception:
        log.exception("Failed to build report")
        body = f"<p>报告生成失败</p>"
    send_email(subject, body)
    log.info("Daily report complete")


if __name__ == "__main__":
    main()
