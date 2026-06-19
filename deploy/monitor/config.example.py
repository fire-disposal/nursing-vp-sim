# Monitor config — all values read from environment (.env).
# Copy or add these to /opt/nursing-vp-sim/.env when deploying.
#
# Required:
#   SMTP_USER=your-email@qq.com
#   SMTP_PASS=your-authorization-code
#
# Optional (defaults shown):
#   SMTP_HOST=smtp.qq.com
#   SMTP_PORT=587
#   MAIL_FROM=your-email@qq.com          # defaults to SMTP_USER
#   MAIL_TO=your-email@qq.com            # comma-separated ok
#   DISK_THRESHOLD_PCT=85
#   CPU_LOAD_MULTIPLIER=1.5
#   MEM_MIN_MB=500
#   PROD_BACKEND_PORT=9001
#   STAGING_BACKEND_PORT=9081
#
# The old config.py file is no longer needed.
