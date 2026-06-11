#!/usr/bin/env python3
"""
System monitoring script — checks Docker containers, resources, HTTP endpoints.
Sends email alerts via SMTP with adaptive cooldown to prevent flooding.
Designed for crontab: */15 * * * * cd /opt/monitor && python3 monitor.py
"""

import json
import logging
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
LOG_FILE = SCRIPT_DIR / "monitor.log"

# ── Thresholds ────────────────────────────────────────────────────────────────
DISK_THRESHOLD_PCT = 85
CPU_LOAD_MULTIPLIER = 1.5     # load avg ÷ cpu cores → alert if above
MEM_MIN_MB = 500              # available memory below this → alert

# ── Cooldown tiers (by alert count for same key) ──────────────────────────────
# Format: (up_to_count, cooldown_minutes)
COOLDOWN_TIERS = [
    (3, 60),     # alerts 1-3:  1 hour between
    (6, 240),    # alerts 4-6:  4 hours between
    (999, 720),  # alerts 7+:   12 hours between
]
MAX_EMAILS_PER_DAY = 20

# ── Load user config ──────────────────────────────────────────────────────────
sys.path.insert(0, str(SCRIPT_DIR))
try:
    from config import *   # noqa: F403  — overrides thresholds / SMTP / ENDPOINTS
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stderr),
    ],
)
log = logging.getLogger("monitor")

# ── Helpers ───────────────────────────────────────────────────────────────────

def run(cmd, timeout=15):
    """Run a shell command, return (rc, stdout)."""
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except subprocess.TimeoutExpired:
        return -1, ""
    except Exception as e:
        return -1, str(e)


def load_state():
    """Load alert state from disk."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_state(state):
    """Persist alert state. Atomic write via temp file."""
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)


def get_cooldown(alert_count):
    """Return cooldown in minutes for a given alert count."""
    for cap, cd in COOLDOWN_TIERS:
        if alert_count <= cap:
            return cd
    return COOLDOWN_TIERS[-1][1]


def should_send(state, alert_key):
    """Return True if this alert should fire now (not in cooldown, not over daily cap)."""
    now = datetime.now()
    today_key = now.strftime("%Y-%m-%d")

    # Daily cap
    daily = state.get("_daily", {})
    if today_key not in daily:
        daily = {"_date": today_key, "_sent": 0}
        state["_daily"] = daily
    if daily.get("_sent", 0) >= MAX_EMAILS_PER_DAY:
        log.warning("Daily email cap (%d) reached, suppressing alert: %s", MAX_EMAILS_PER_DAY, alert_key)
        return False

    entry = state.get(alert_key)
    if entry is None:
        return True  # never alerted before

    # If previously resolved, allow new alert (new incident)
    if entry.get("resolved"):
        return True

    last_at = datetime.fromisoformat(entry["last_alert"])
    cooldown = get_cooldown(entry.get("count", 1))
    if now - last_at >= timedelta(minutes=cooldown):
        return True

    return False


# ── Check functions — each returns list of failure dicts ──────────────────────

def check_containers():
    """Check all Docker containers are running and healthy."""
    failures = []
    rc, out = run("docker ps -a --format json 2>/dev/null")
    if rc != 0:
        failures.append({"type": "container", "name": "docker-daemon", "detail": "Docker daemon unreachable"})
        return failures

    for line in out.splitlines():
        if not line.strip():
            continue
        try:
            c = json.loads(line)
        except json.JSONDecodeError:
            continue
        name = c.get("Names", "?")
        state = c.get("State", "?")
        status = c.get("Status", "")

        if state != "running":
            failures.append({
                "type": "container",
                "name": name,
                "detail": f"State={state}, Status={status}",
            })
        elif "unhealthy" in status.lower():
            failures.append({
                "type": "container",
                "name": name,
                "detail": f"Healthcheck failing — {status}",
            })

    return failures


def check_disk():
    """Check disk usage on root partition."""
    rc, out = run("df -h / | tail -1")
    if rc != 0:
        return []
    parts = out.split()
    if len(parts) < 5:
        return []
    use_pct = parts[4].replace("%", "")
    try:
        pct = int(use_pct)
    except ValueError:
        return []
    if pct >= DISK_THRESHOLD_PCT:
        total, used, avail = parts[1], parts[2], parts[3]
        return [{"type": "disk", "name": "/", "detail": f"{pct}% used — total={total}, used={used}, avail={avail}"}]
    return []


def check_cpu():
    """Check system load average vs CPU cores."""
    try:
        cores = os.cpu_count() or 1
    except Exception:
        cores = 1
    try:
        load1 = float(Path("/proc/loadavg").read_text().split()[0])
    except Exception:
        return []
    threshold = cores * CPU_LOAD_MULTIPLIER
    if load1 > threshold:
        loads = Path("/proc/loadavg").read_text().strip()
        return [{"type": "cpu", "name": "loadavg", "detail": f"load={loads} (cores={cores}, threshold={threshold:.1f})"}]
    return []


def check_memory():
    """Check available memory."""
    try:
        meminfo = Path("/proc/meminfo").read_text()
    except Exception:
        return []
    mem = {}
    for line in meminfo.splitlines():
        parts = line.split(":")
        if len(parts) >= 2:
            key = parts[0].strip()
            val = parts[1].strip().split()[0]
            try:
                mem[key] = int(val)
            except ValueError:
                pass
    total = mem.get("MemTotal", 0) // 1024
    available = mem.get("MemAvailable", 0) // 1024
    if 0 < available < MEM_MIN_MB:
        return [{"type": "memory", "name": "RAM", "detail": f"Available={available}MB / Total={total}MB (threshold={MEM_MIN_MB}MB)"}]
    return []


def check_health_endpoints():
    """Check HTTP health endpoints listed in config.ENDPOINTS."""
    endpoints = getattr(sys.modules.get("config", None), "ENDPOINTS", [])
    if not endpoints:
        return []
    failures = []
    for ep in endpoints:
        url = ep["url"]
        name = ep.get("name", url)
        rc, out = run(f"curl -sS -m 10 -w '\\n%{{http_code}}' {url}")
        if rc != 0:
            failures.append({"type": "health", "name": name, "detail": f"不可达: {out[:200]}"})
            continue
        lines = out.splitlines()
        if len(lines) < 2:
            failures.append({"type": "health", "name": name, "detail": f"异常响应: {out[:200]}"})
            continue
        http_code = lines[-1]
        body = "\n".join(lines[:-1])
        if http_code != "200":
            failures.append({"type": "health", "name": name, "detail": f"HTTP {http_code}"})
            continue
        try:
            raw = json.loads(body)
        except json.JSONDecodeError:
            continue

        data = raw.get("data", raw) if isinstance(raw, dict) else raw

        status = data.get("status", "")
        if status not in ("ok", "healthy"):
            failures.append({"type": "health", "name": name, "detail": f"状态异常: status={status}"})

        if data.get("db") == "error" or data.get("database") == "error":
            failures.append({"type": "health", "name": name, "detail": "数据库连接失败"})

        if data.get("llm") in ("unavailable", "low"):
            label = "LLM 额度不足" if data["llm"] == "low" else "LLM 不可用"
            failures.append({"type": "health", "name": name, "detail": label})

    return failures


def fetch_metrics(endpoint_url: str) -> dict | None:
    """Fetch /api/metrics from an endpoint. Returns None if unavailable."""
    metrics_url = endpoint_url.replace("/api/health", "/api/metrics")
    rc, out = run(f"curl -sS -m 10 '{metrics_url}'")
    if rc != 0:
        return None
    try:
        raw = json.loads(out)
        if isinstance(raw, dict):
            inner = raw.get("data")
            if isinstance(inner, dict):
                return inner
        return raw
    except json.JSONDecodeError:
        return None


def _delta(prev: dict, key: str) -> int:
    """Calculate delta between current and previous counter value."""
    old = prev.get("_metrics_prev", {}).get(key, 0)
    cur = prev.get(key, 0)
    return max(0, cur - old)


def check_metrics_anomalies(state: dict):
    """Fetch metrics from each endpoint and detect anomalies via delta comparison.
    Receives state dict from caller to avoid overwrite race with main()."""
    endpoints = getattr(sys.modules.get("config", None), "ENDPOINTS", [])
    anomalies = []

    for ep in endpoints:
        name = ep.get("name", ep["url"])
        key = f"metrics:{name}"
        prev = state.get(key, {})

        m = fetch_metrics(ep["url"])
        if m is None:
            continue

        reqs = m.get("requests", {})
        llm = m.get("llm", {})

        requests_15m = _delta({"requests": reqs, "_metrics_prev": prev}, "total")
        errors_15m = reqs.get("by_status", {}).get("5xx", 0) - prev.get("_metrics_prev", {}).get("err5xx", 0)
        errors_15m = max(0, errors_15m)

        # Anomaly: request count dropped > 80% vs previous 15-min window
        prev_requests = prev.get("_metrics_prev", {}).get("_requests_delta", 50)
        if prev_requests > 50 and requests_15m < prev_requests * 0.2:
            anomalies.append({
                "type": "metrics", "name": name,
                "detail": f"请求量骤降: 前周期={prev_requests}, 当前={requests_15m}",
            })

        # Anomaly: error rate > 10% in last window
        if requests_15m > 20 and errors_15m / requests_15m > 0.10:
            anomalies.append({
                "type": "metrics", "name": name,
                "detail": f"错误率飙升: {errors_15m}/{requests_15m} ({errors_15m/requests_15m*100:.0f}%)",
            })

        # Anomaly: LLM degraded providers > 0
        degraded = llm.get("degraded_providers", 0)
        if degraded > 0:
            anomalies.append({
                "type": "metrics", "name": name,
                "detail": f"LLM Provider 降级: {degraded} 个",
            })

        # Anomaly: global LLM degraded
        if llm.get("global_degraded"):
            anomalies.append({
                "type": "metrics", "name": name,
                "detail": "LLM 全局降级",
            })

        # Store current snapshot for next comparison, preserving alert state
        prev_entry = state.get(key, {})
        state[key] = {
            "total": reqs.get("total", 0),
            "err5xx": reqs.get("by_status", {}).get("5xx", 0),
            "uptime_seconds": m.get("uptime_seconds", 0),
            "active_sessions": m.get("active_sessions", 0),
            "llm_calls": llm.get("calls_total", 0),
            "llm_errors": llm.get("calls_error", 0),
            "llm_tokens": llm.get("tokens_used", 0),
            "degraded": llm.get("degraded_providers", 0),
            "p95_ms": reqs.get("latency_ms", {}).get("p95", 0),
            "resolved": prev_entry.get("resolved", False),
            "resolved_at": prev_entry.get("resolved_at"),
            "_metrics_prev": {
                "total": prev.get("total", 0),
                "err5xx": prev.get("err5xx", 0),
                "_requests_delta": requests_15m,
            },
        }

    return anomalies


# ── Alert key helpers ─────────────────────────────────────────────────────────

def alert_key(failure):
    """Map a failure dict to a stable alert key for dedup."""
    tp = failure["type"]
    name = failure.get("name", "?")
    if tp == "container":
        return f"container:{name}"
    elif tp == "disk":
        return "disk:root"
    elif tp == "cpu":
        return "cpu:high"
    elif tp == "memory":
        return "mem:low"
    elif tp == "health":
        return f"health:{name}"
    return f"{tp}:{name}"


# ── Email ─────────────────────────────────────────────────────────────────────

MONITOR_CSS = """
:root{color-scheme:light dark}
body{margin:0;padding:24px;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#1e293b;line-height:1.5}
.container{max-width:640px;margin:0 auto}
.header{padding:0 0 16px;border-bottom:2px solid #e2e8f0}
.header h2{font-size:18px;margin:0;color:#dc2626}
.header .sub{font-size:12px;color:#94a3b8;margin-top:4px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-top:16px}
.card h3{font-size:13px;margin:0 0 12px;color:#475569}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:600;color:#64748b}
td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
tr:last-child td{border-bottom:none}
.footer{margin-top:16px;text-align:center;font-size:11px;color:#cbd5e1}
@media (prefers-color-scheme:dark){
  body{background:#0f1117;color:#c9d1d9}
  .header{border-bottom-color:#21262d}
  .header h2{color:#f85149}
  .header .sub{color:#8b949e}
  .card{background:#161b22;border-color:#21262d}
  .card h3{color:#8b949e}
  th{border-bottom-color:#21262d;color:#8b949e}
  td{border-bottom-color:#161b22}
  .footer{color:#30363d}
}
"""


def build_email_body(failures, hostname):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = ""
    for f in failures:
        type_cn = {"container": "容器", "disk": "磁盘", "cpu": "CPU", "memory": "内存", "health": "健康检查"}.get(f["type"], f["type"])
        rows += f"<tr><td>{type_cn}</td><td>{f.get('name','-')}</td><td style='font-size:11px'>{f.get('detail','')}</td></tr>"

    return f"""\
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{MONITOR_CSS}</style></head>
<body>
<div class="container">
<div class="header">
  <h2>告警通知</h2>
  <div class="sub">{hostname} &middot; {now}</div>
</div>
<div class="card">
  <h3>发现 {len(failures)} 个异常</h3>
  <table>
    <tr><th>类型</th><th>目标</th><th>详情</th></tr>
    {rows}
  </table>
</div>
<div class="footer">由 monitor.py 自动发送 &middot; 冷却期内不重复告警</div>
</div></body></html>"""


def build_recovery_body(recovered_keys, hostname):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    items = "".join(f"<li>{k}</li>" for k in recovered_keys)
    return f"""\
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{MONITOR_CSS}</style></head>
<body>
<div class="container">
<div class="header" style="border-bottom-color:#22c55e">
  <h2 style="color:#059669">恢复通知</h2>
  <div class="sub">{hostname} &middot; {now}</div>
</div>
<div class="card">
  <h3>以下问题已恢复：</h3>
  <ul style="font-size:13px;line-height:1.8">{items}</ul>
</div>
<div class="footer">由 monitor.py 自动发送</div>
</div></body></html>"""


def send_email(subject, body_html):
    """Send email via SMTP from config."""
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

        log.info("Email sent: %s", subject)
        return True
    except Exception as e:
        log.error("Email failed: %s", e)
        return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    now = datetime.now()
    hostname = "yeacoyun"

    state = load_state()
    daily = state.get("_daily", {})
    today = now.strftime("%Y-%m-%d")
    if daily.get("_date") != today:
        daily = {"_date": today, "_sent": 0}
        state["_daily"] = daily

    # Run all checks
    all_failures = []
    for check_fn in [check_containers, check_disk, check_cpu, check_memory, check_health_endpoints]:
        all_failures.extend(check_fn())
    all_failures.extend(check_metrics_anomalies(state))

    # Determine current failing keys
    active_keys = set(alert_key(f) for f in all_failures)

    # Detect recoveries: keys in state that are not marked resolved but are no longer failing
    recovered_keys = []
    for key, entry in state.items():
        if key.startswith("_"):
            continue
        if not entry.get("resolved") and key not in active_keys:
            recovered_keys.append(key)

    # Send recovery email
    if recovered_keys:
        for key in recovered_keys:
            state[key]["resolved"] = True
            state[key]["resolved_at"] = now.isoformat()
        rec_subject = f"[RECOVERY] {hostname} — {len(recovered_keys)} issue(s) resolved"
        rec_body = build_recovery_body(recovered_keys, hostname)
        if send_email(rec_subject, rec_body):
            daily["_sent"] = daily.get("_sent", 0) + 1

    # Process active failures — decide which to alert on
    new_failures = []
    for f in all_failures:
        key = alert_key(f)
        entry = state.get(key)

        if entry and entry.get("resolved"):
            # Was resolved, now failing again — new incident
            entry = None
            state[key] = {}

        if entry is None:
            # First alert for this key
            state[key] = {
                "last_alert": now.isoformat(),
                "count": 1,
                "resolved": False,
                "detail": f["detail"],
            }
            new_failures.append(f)
        elif should_send(state, key):
            entry["last_alert"] = now.isoformat()
            entry["count"] = entry.get("count", 0) + 1
            entry["detail"] = f["detail"]
            new_failures.append(f)
        else:
            # Update detail silently
            entry["detail"] = f["detail"]

    # Send alert email
    if new_failures:
        subject = f"[ALERT] {hostname} — {len(new_failures)} issue(s)"
        body = build_email_body(new_failures, hostname)
        if send_email(subject, body):
            daily["_sent"] = daily.get("_sent", 0) + 1
            log.info("Alert sent: %d failures", len(new_failures))

        _trigger_diagnosis(new_failures, hostname)
    else:
        log.info("Check OK — no new alerts to send. Active issues: %d", len(active_keys))

    save_state(state)


def _trigger_diagnosis(failures: list[dict], hostname: str) -> None:
    """Trigger GitHub Actions auto-diagnose workflow for new failures.
    Cooldown: 2 hours per (service, symptom) pair to prevent flooding."""
    try:
        import os
        token = os.environ.get("GITHUB_TOKEN", "")
        if not token:
            log.info("Auto-diagnose skipped: GITHUB_TOKEN not set")
            return

        from urllib.request import Request, urlopen

        state = load_state()
        diag_state = state.get("_diagnosis", {})

        for f in failures[:3]:
            if f["type"] == "metrics":
                continue

            svc = "staging" if "staging" in f.get("name", "") else "prod"
            sym = f["detail"][:100]
            diag_key = f"diag_{svc}_{sym[:50]}"

            now = datetime.now()
            last_run_str = diag_state.get(diag_key)
            if last_run_str:
                try:
                    last_run = datetime.fromisoformat(last_run_str)
                    if (now - last_run).total_seconds() < 2 * 3600:
                        log.info("Auto-diagnose cooldown: %s (last run %s)", diag_key, last_run_str)
                        continue
                except ValueError:
                    pass

            body = json.dumps({
                "ref": "master",
                "inputs": {
                    "service": svc,
                    "symptom": sym,
                    "time_range": "30m",
                },
            })
            req = Request(
                f"https://api.github.com/repos/fire-disposal/nursing-vp-sim/actions/workflows/auto-diagnose.yml/dispatches",
                data=body.encode(),
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "monitor.py/auto-diagnose",
                },
            )
            urlopen(req, timeout=10)
            log.info("Auto-diagnose triggered: service=%s symptom=%s", svc, sym)

            diag_state[diag_key] = now.isoformat()
            state["_diagnosis"] = diag_state
            save_state(state)
    except Exception as e:
        log.warning("Auto-diagnose trigger failed: %s", e)


if __name__ == "__main__":
    main()
