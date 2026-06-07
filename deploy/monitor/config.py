# ── monitoring config ──────────────────────────────────────────────────────────
# Fill in your SMTP credentials below, then place this file alongside monitor.py

# QQ SMTP
SMTP_HOST = "smtp.qq.com"
SMTP_PORT = 587
SMTP_USER = "3295829485@qq.com"
SMTP_PASS = "hptlczrhwdmudadi"
MAIL_FROM = "3295829485@qq.com"
MAIL_TO   = [
    "3295829485@qq.com",
    # "other@example.com",
]

# ── Thresholds (optional — defaults below) ────────────────────────────────────
# DISK_THRESHOLD_PCT = 85
# CPU_LOAD_MULTIPLIER = 1.5
# MEM_MIN_MB = 500

# ── HTTP health endpoints to probe ────────────────────────────────────────────
ENDPOINTS = [
    {"name": "nursing-prod-backend",   "url": "http://localhost:9001/api/health"},
    {"name": "nursing-staging-backend","url": "http://localhost:9081/api/health"},
    # Uncomment and adjust if emoguard has a health endpoint:
    # {"name": "emoguard-backend",      "url": "http://localhost:8000/api/health"},
]
