"""
Shared env config for monitor scripts. Reads from os.environ,
falling back to /opt/nursing-vp-sim/.env for token secrets.
No hardcoded credentials — all values come from environment.
"""
import os
import logging
from pathlib import Path

log = logging.getLogger("monitor.env")

_ENV_FILE = Path("/opt/nursing-vp-sim/.env")

def _from_env_file(key: str) -> str | None:
    if not _ENV_FILE.exists():
        return None
    for line in _ENV_FILE.read_text(errors="replace").splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip("\"'")
    return None

def _get(key: str, default: str = "") -> str:
    return os.getenv(key) or _from_env_file(key) or default

# ── SMTP ────────────────────────────────────────────────────────────────
SMTP_HOST = _get("SMTP_HOST", "smtp.qq.com")
SMTP_PORT = int(_get("SMTP_PORT", "587"))
SMTP_USER = _get("SMTP_USER")
SMTP_PASS = _get("SMTP_PASS")
MAIL_FROM = _get("MAIL_FROM") or SMTP_USER
_MAIL_TO_RAW = _get("MAIL_TO") or SMTP_USER
MAIL_TO = [a.strip() for a in _MAIL_TO_RAW.split(",") if a.strip()]

# ── Thresholds ───────────────────────────────────────────────────────────
DISK_THRESHOLD_PCT = int(_get("DISK_THRESHOLD_PCT", "85"))
CPU_LOAD_MULTIPLIER = float(_get("CPU_LOAD_MULTIPLIER", "1.5"))
MEM_MIN_MB = int(_get("MEM_MIN_MB", "500"))

# ── Endpoints ────────────────────────────────────────────────────────────
ENDPOINTS = [
    {"name": "nursing-prod-backend", "url": f"http://localhost:{_get('PROD_BACKEND_PORT','9001')}/api/health"},
    {"name": "nursing-staging-backend","url": f"http://localhost:{_get('STAGING_BACKEND_PORT','9081')}/api/health"},
]

# ── Report & Diagnose ────────────────────────────────────────────────────
_REPORT_PORTS = {
    "prod": int(_get("PROD_BACKEND_PORT", "9001")),
    "staging": int(_get("STAGING_BACKEND_PORT", "9081")),
}
DIAGNOSE_TOKEN = _get("DIAGNOSE_TOKEN")

# ── Server identity ──────────────────────────────────────────────────────
try:
    HOSTNAME = os.uname().nodename
except AttributeError:
    HOSTNAME = "nursing-server"
