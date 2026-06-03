import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

LOG_DIR = Path(os.getenv("LOG_DIR", Path(__file__).resolve().parent.parent / "logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)

_fmt = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s %(filename)s:%(lineno)d: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

log = logging.getLogger("nursing")
log.setLevel(getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO))

_ch = logging.StreamHandler(sys.stderr)
_ch.setFormatter(_fmt)
log.addHandler(_ch)

_fh = RotatingFileHandler(str(LOG_DIR / "app.log"), encoding="utf-8", maxBytes=10 * 1024 * 1024, backupCount=5)
_fh.setFormatter(_fmt)
log.addHandler(_fh)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s", handlers=[logging.StreamHandler(sys.stderr)])
