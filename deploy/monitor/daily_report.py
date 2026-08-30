#!/usr/bin/env python3
"""Daily report — calls /api/diagnose, highlights exceptions & changes.

Exception-first design:
  • No success rate percentages (always 99%+, noise)
  • Alerts at top → error deltas → scoring → budget → resources
  • DingTalk: pure exception digest

Cron: 0 9 * * * cd /opt/monitor && /usr/bin/python3 daily_report.py
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

SCRIPT_DIR = Path(__file__).resolve().parent
LOG_FILE = SCRIPT_DIR / "daily_report.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler(sys.stderr)],
)
log = logging.getLogger("daily_report")

sys.path.insert(0, str(SCRIPT_DIR))

from _env import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO, DIAGNOSE_TOKEN, HOSTNAME  # noqa: E402
from _env import _REPORT_PORTS, DINGTALK_WEBHOOK, FEEDBACK_BOT_TOKEN  # noqa: E402

if not SMTP_HOST:
    log.warning("SMTP_HOST not configured, email disabled")


# ── Data fetching ─────────────────────────────────────────────────────────────


def fetch_report(port: int) -> dict | None:
    url = f"http://127.0.0.1:{port}/api/diagnose"
    if DIAGNOSE_TOKEN:
        url += f"?token={DIAGNOSE_TOKEN}"
    try:
        r = subprocess.run(
            ["curl", "-sS", "-m", "10", url],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode != 0:
            return None
        data = json.loads(r.stdout)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def fetch_all_reports() -> tuple[dict, dict]:
    data = {}
    online = {}
    for key, port in _REPORT_PORTS.items():
        rpt = fetch_report(port)
        data[key] = rpt
        online[key] = rpt is not None
    return data, online


def fetch_feedback_unreplied() -> int:
    """Fetch count of unreplied user feedback from prod backend via bot API."""
    port = _REPORT_PORTS.get("prod", 9001)
    if not FEEDBACK_BOT_TOKEN:
        return 0
    url = f"http://127.0.0.1:{port}/api/feedback/bot?token={FEEDBACK_BOT_TOKEN}&replied=false&limit=1"
    try:
        r = subprocess.run(
            ["curl", "-sS", "-m", "5", url],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode != 0:
            return 0
        data = json.loads(r.stdout)
        return data.get("total", 0) if isinstance(data, dict) else 0
    except Exception:
        return 0


# ── HTML helpers ──────────────────────────────────────────────────────────────


def _card(title: str, emoji: str = "", extra_cls: str = "") -> str:
    cls = f' class="{extra_cls}"' if extra_cls else ""
    prefix = f"<span>{emoji} </span>" if emoji else ""
    return f'<div class="card"{cls}><h2>{prefix}{title}</h2>'


def _tag(text: str, cls: str) -> str:
    return f'<span class="tag tag-{cls}">{text}</span>'


def _row(label: str, *cells: str) -> str:
    cells_html = "".join(f'<td class="r">{c}</td>' for c in cells)
    return f"<tr><td>{label}</td>{cells_html}</tr>"


# ── Report builder ────────────────────────────────────────────────────────────


def build_email(data: dict, online: dict) -> str:
    now = datetime.now()
    date_str, time_str = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")
    prod, stag = data.get("prod") or {}, data.get("staging") or {}
    sections = []

    # ── Header ──
    prod_status = prod.get("summary", {}).get("status", "unknown")
    stag_status = stag.get("summary", {}).get("status", "unknown")
    overall = "healthy" if prod_status == "healthy" and stag_status == "healthy" else "degraded"
    header = f"""<div class="header">
  <h1>VP-SIM 运维日报</h1>
  <div class="sub">{date_str} {time_str} ｜ {HOSTNAME}</div>
  <div class="status-bar {overall}">
    {'🟢 运行正常' if overall == 'healthy' else '🟡 存在异常'} ｜
    正式服: {prod.get('version', '-')} ｜
    测试服: {stag.get('version', '-')}
  </div>
</div>"""
    sections.append(header)

    # ── Alerts — top priority ──
    pa = prod.get("alerts") or []
    sa = stag.get("alerts") or []
    if pa or sa:
        rows = ""
        for a in pa:
            rows += f"<tr><td class='r'>{_tag('正式', 'err')}</td><td>{a}</td></tr>"
        for a in sa:
            rows += f"<tr><td class='r'>{_tag('测试', 'warn')}</td><td>{a}</td></tr>"
        sections.append(_card("异常", "⚠️", "h-err") + f"<table>{rows}</table></div>")
    else:
        sections.append(_card("异常", "✅", "h-ok") + '<div class="status-ok">无异常</div></div>')

    # ── Error ring-buffer (recent errors, not rates) ──
    pe = prod.get("errors") or {}
    se = stag.get("errors") or {}
    err_rows = ""
    for label, env_err, env_name in [
        ("正式服", pe, "prod"), ("测试服", se, "staging"),
    ]:
        c = env_err.get("count", {})
        err_rows += (
            f"<tr><td>{env_name}</td>"
            f"<td class='r'>{c.get('last_5min', '-')}</td>"
            f"<td class='r'>{c.get('last_hour', '-')}</td>"
            f"<td class='r'>{c.get('unique_24h', '-')}</td>"
            f"<td class='r'>{c.get('total_captured', '-')}</td></tr>"
        )
    sections.append(
        _card("错误捕获", "📊")
        + "<table><tr><th></th><th class='r'>近 5min</th><th class='r'>近 1h</th><th class='r'>24h 去重</th><th class='r'>缓冲区</th></tr>"
        + err_rows
        + "</table></div>"
    )

    # ── Unreplied feedback ──
    unreplied = fetch_feedback_unreplied()
    tag_cls = "warn" if unreplied > 10 else ("err" if unreplied > 0 else "ok")
    sections.append(
        _card("用户反馈", "💬")
        + f"<div>未回复 <strong>{unreplied}</strong> 条 {_tag('待回复' if unreplied else '无', tag_cls)}</div></div>"
    )

    # ── LLM error types (actionable: which errors, not success rate) ──
    for env_name, pl in [("正式服", prod.get("llm", {})), ("测试服", stag.get("llm", {}))]:
        errs = pl.get("recent_errors") or []
        if errs:
            detail = " ｜ ".join(f"{e['type']} ×{e['count']}" for e in errs[:5])
            sections.append(
                _card(f"LLM 错误 — {env_name}", "🤖")
                + f'<div class="mono">{detail}</div></div>'
            )

    # ── Scoring health ──
    for env_name, ps in [
        ("正式服", prod.get("scoring", {})), ("测试服", stag.get("scoring", {})),
    ]:
        completed = ps.get("completed_24h", 0)
        failed = ps.get("failed_24h", 0)
        pending = ps.get("pending", 0)
        ip = ps.get("in_progress", 0)
        sr = ps.get("success_rate", 100)
        sc_tag = "err" if sr < 80 else ("warn" if failed > 0 else "ok")
        sc_label = f"成功率 {sr}%" if sr < 100 else "正常"
        sections.append(
            _card(f"评分队列 — {env_name}", "🎯")
            + f"<div>成功率 <strong>{sr}%</strong> ｜ "
            f"完成 <strong>{completed}</strong> ｜ 失败 <strong>{failed}</strong> ｜ "
            f"待处理 <strong>{pending}</strong> ｜ "
            f"进行中 <strong>{ip}</strong> ｜ "
            f"{_tag(sc_label, sc_tag)}</div></div>"
        )

    # ── Voice budget ──
    vb = prod.get("voice_budget") or {}
    if vb.get("monthly_budget", 0) > 0:
        pct = vb.get("usage_pct", 0)
        cost = vb.get("monthly_cost", 0)
        budget = vb.get("monthly_budget", 0)
        pct_tag = "err" if pct >= 90 else ("warn" if pct >= 75 else "ok")
        sections.append(
            _card("语音预算", "💰")
            + f"<div>¥{cost:.0f} / ¥{budget:.0f} ｜ "
            f"{_tag(f'{pct:.0f}%', pct_tag)}</div></div>"
        )

    # ── Voice errors (not rates) ──
    for env_name, pv in [
        ("正式服", prod.get("voice", {})), ("测试服", stag.get("voice", {})),
    ]:
        tts = pv.get("tts") or {}
        te = tts.get("error_count_24h", 0)
        tc = tts.get("calls_24h", 0)
        if tc:
            sections.append(
                _card(f"语音 — {env_name}", "🔊")
                + f"<div>TTS <strong>{tc}</strong>次 ｜ 错误 <strong>{te}</strong></div></div>"
            )

    # ── Request volume — 5xx matters ──
    for env_name, pm in [
        ("正式服", prod.get("metrics", {})), ("测试服", stag.get("metrics", {})),
    ]:
        reqs = pm.get("requests") or {}
        total = reqs.get("total", 0)
        by_status = reqs.get("by_status") or {}
        s5xx = by_status.get("5xx", 0)
        sessions = pm.get("active_sessions", "-")
        latency = (reqs.get("latency_ms") or {}).get("avg", "-")
        if total:
            sections.append(
                _card(f"请求量 — {env_name}", "📈")
                + f"<div>总计 <strong>{total}</strong> ｜ "
                f"5xx <strong>{s5xx}</strong> ｜ "
                f"会话 <strong>{sessions}</strong> ｜ "
                f"延迟 <strong>{latency}ms</strong></div></div>"
            )

    # ── LLM degradation — 区分余额耗尽(需充值)与官方容量波动(等待恢复) ──
    for env_name, pm in [
        ("正式服", prod.get("metrics", {})), ("测试服", stag.get("metrics", {})),
    ]:
        llm_m = (pm.get("llm") or {}) if isinstance(pm, dict) else {}
        degraded = llm_m.get("degraded_providers", 0)
        gd = llm_m.get("global_degraded", False)
        if degraded or gd:
            by_reason = llm_m.get("degraded_by_reason") or {}
            balance = int(by_reason.get("insufficient_balance", 0) or 0)
            capacity = max(0, degraded - balance)
            parts = [f"降级 Provider: {degraded} 个"]
            if balance:
                parts.append(f"余额不足 {balance} 个 (需充值)")
            if capacity:
                parts.append(f"容量波动 {capacity} 个")
            if gd:
                parts.append("全局降级")
            # 余额不足/全局降级属需关注项标红，纯容量波动仅作提示
            severity = "h-err" if (balance or gd) else ""
            sections.append(
                _card(f"LLM 状态 — {env_name}", "⚡", severity)
                + f'<div class="mono">{" ｜ ".join(parts)}</div></div>'
            )

    # ── Uptime ──
    rows = ""
    for env_name, pm in [("正式服", prod), ("测试服", stag)]:
        u = (pm.get("metrics") or {}).get("uptime_seconds", 0)
        rows += _row(env_name, f"{u / 3600:.1f}h")
    sections.append(
        _card("运行时长", "⏱️") + f"<table>{rows}</table></div>"
    )

    body = "\n".join(sections)
    return WRAPPER.replace("__BODY__", body).replace("__DATE__", date_str)


# ── CSS & Wrapper ─────────────────────────────────────────────────────────────

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
.container{max-width:640px;margin:0 auto}
.header{padding:0 0 20px;border-bottom:2px solid var(--c-card-bd);margin-bottom:4px}
.header h1{font-size:18px;font-weight:700;margin:0;color:var(--c-accent)}
.header .sub{font-size:12px;color:var(--c-dim);margin-top:2px}
.status-bar{margin-top:10px;padding:8px 12px;border-radius:6px;font-size:12px;font-weight:500}
.status-bar.healthy{background:rgba(34,197,94,.1);color:var(--c-ok)}
.status-bar.degraded{background:rgba(245,158,11,.1);color:var(--c-warn)}
.card{background:var(--c-card);border:1px solid var(--c-card-bd);
  border-radius:8px;padding:14px 18px;margin-top:12px}
.card h2{font-size:12px;font-weight:600;margin:0 0 10px;color:var(--c-sub);
  letter-spacing:.3px;padding-bottom:8px;border-bottom:1px solid var(--c-card-bd)}
.h-err h2{color:var(--c-err)!important;border-bottom-color:rgba(239,68,68,.2)!important}
.h-ok h2{color:var(--c-ok)!important;border-bottom-color:rgba(34,197,94,.2)!important}
.status-ok{color:var(--c-ok);font-size:13px;font-weight:500}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:6px 8px;border-bottom:2px solid var(--c-card-bd);
  font-size:11px;font-weight:600;color:var(--c-dim)}
td{padding:6px 8px;border-bottom:1px solid var(--c-card-bd);font-size:13px}
.r{text-align:right}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600}
.tag-ok{background:rgba(34,197,94,.1);color:var(--c-ok)}
.tag-warn{background:rgba(245,158,11,.1);color:var(--c-warn)}
.tag-err{background:rgba(239,68,68,.1);color:var(--c-err)}
.mono{font-family:'SF Mono',Menlo,monospace;font-size:12px;line-height:1.6;color:var(--c-txt)}
.footer{margin-top:16px;text-align:center;font-size:11px;color:var(--c-dim)}
"""

WRAPPER = (
    '<!DOCTYPE html><html><head><meta charset="utf-8">'
    '<meta name="color-scheme" content="light dark">'
    f"<style>{CSS}</style></head><body><div class='container'>"
    "__BODY__"
    '<div class="footer">daily_report.py · __DATE__</div>'
    "</div></body></html>"
)


# ── DingTalk ──────────────────────────────────────────────────────────────────


def build_dingtalk_summary(data: dict, online: dict) -> str:
    now = datetime.now().strftime("%Y-%m-%d")
    prod, stag = data.get("prod") or {}, data.get("staging") or {}
    unreplied = fetch_feedback_unreplied()

    lines = [f"## 📋 VP-SIM 日报 · {now}", ""]

    def _section(title: str, env: dict, is_up: bool, extras: list[str]) -> list[str]:
        if not is_up:
            return [f"### {title} 🔴 无响应", ""]
        version = env.get("version", "-")
        exc: list[str] = []
        err_1h = ((env.get("errors") or {}).get("count") or {}).get("last_hour", 0)
        if err_1h > 0:
            exc.append(f"> ⚠️ 近 1h 服务端错误 {err_1h} 条")
        for a in env.get("alerts") or []:
            exc.append(f"> ⚠️ {a}")
        exc.extend(extras)
        lamp = "🟢" if not exc else "🟡"
        sec = [f"### {title} {lamp} {version}"]
        biz = env.get("business") or {}
        if biz:
            sec.append(f"今日用户 **{biz.get('today_users', 0)}** 人")
            sec.append(f"今日训练 **{biz.get('today_trainings', 0)}** 次（完成 {biz.get('today_completed', 0)}）")
        sec.extend(exc)
        sec.append("")
        return sec

    fb_line = [f"> 💬 未回复用户反馈 {unreplied} 条"] if unreplied else []
    lines += _section("🧪 测试服", stag, online.get("staging", False), [])
    lines += _section("🏥 正式服", prod, online.get("prod", False), fb_line)

    return "\n".join(lines).rstrip()


def send_dingtalk(text: str) -> bool:
    if not DINGTALK_WEBHOOK:
        return False
    try:
        import urllib.request

        payload = json.dumps({"msgtype": "markdown", "markdown": {"title": "VP-SIM 日报", "text": text}}).encode()
        req = urllib.request.Request(DINGTALK_WEBHOOK, data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        log.info("DingTalk sent")
        return True
    except Exception as e:
        log.error("DingTalk failed: %s", e)
        return False


# ── Email ─────────────────────────────────────────────────────────────────────


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
        log.info("Email sent: %s", subject)
        return True
    except Exception as e:
        log.error("Email failed: %s", e)
        return False


# ── Report gating ────────────────────────────────────────────────────────────


def should_push(data: dict, online: dict) -> bool:
    """Whether today's report is worth sending.

    Skips on a quiet day: no business activity (0 users / 0 trainings / 0
    completed across prod & staging) and no real anomalies to surface. An
    offline endpoint is itself an anomaly → always push.
    """
    if not (online.get("prod") and online.get("staging")):
        return True
    has_business = False
    for env in ("prod", "staging"):
        biz = (data.get(env) or {}).get("business") or {}
        if any((biz.get(k) or 0) > 0 for k in ("today_users", "today_trainings", "today_completed")):
            has_business = True
            break
    if has_business:
        return True
    for env in ("prod", "staging"):
        if (data.get(env) or {}).get("alerts"):
            return True
    return False


# ── Main ──────────────────────────────────────────────────────────────────────


def main():
    now = datetime.now()
    subject = f"VP-SIM 运维日报 — {now.strftime('%Y-%m-%d')}"
    log.info("Building daily report...")

    data, online = fetch_all_reports()

    if not should_push(data, online):
        log.info("No business activity and no anomalies — skipping daily report")
        return

    try:
        body = build_email(data, online)
    except Exception:
        log.exception("Failed to build email")
        body = "<p>报告生成失败</p>"

    send_email(subject, body)

    try:
        dt_text = build_dingtalk_summary(data, online)
        send_dingtalk(dt_text)
    except Exception:
        log.exception("Failed to send DingTalk")

    log.info("Daily report done")


if __name__ == "__main__":
    main()
