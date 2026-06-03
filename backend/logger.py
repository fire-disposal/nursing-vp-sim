import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_fmt = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s %(filename)s:%(lineno)d: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

log = logging.getLogger("nursing")
log.setLevel(getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO))
log.propagate = False

_ch = logging.StreamHandler(sys.stdout)
_ch.setFormatter(_fmt)
log.addHandler(_ch)

try:
    LOG_DIR = Path(os.getenv("LOG_DIR", Path(__file__).resolve().parent.parent / "logs"))
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    _fh = RotatingFileHandler(str(LOG_DIR / "app.log"), encoding="utf-8", maxBytes=10 * 1024 * 1024, backupCount=5)
    _fh.setFormatter(_fmt)
    log.addHandler(_fh)
except Exception as _e:
    sys.stdout.write(f"[logger] 文件日志初始化失败，仅输出到控制台: {_e}\n")