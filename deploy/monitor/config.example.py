# ── monitoring config ──────────────────────────────────────────────────────────
# Copy this file to config.py and fill in your SMTP credentials.
# config.py is git-ignored — never commit real credentials.

# QQ SMTP
SMTP_HOST = "smtp.qq.com"
SMTP_PORT = 587
SMTP_USER = "your-email@qq.com"
SMTP_PASS = "your-authorization-code"
MAIL_FROM = "your-email@qq.com"
MAIL_TO = ["your-email@qq.com"]

# ── Thresholds (optional — defaults below) ────────────────────────────────────
# DISK_THRESHOLD_PCT = 85
# CPU_LOAD_MULTIPLIER = 1.5
# MEM_MIN_MB = 500

# ── HTTP health endpoints to probe ────────────────────────────────────────────
ENDPOINTS = [
    {"name": "nursing-prod-backend",   "url": "http://localhost:9001/api/health"},
    {"name": "nursing-staging-backend","url": "http://localhost:9081/api/health"},
]
