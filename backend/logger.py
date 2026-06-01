import logging, json, sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

sys.stderr.reconfigure(encoding="utf-8")

log = logging.getLogger("nursing")
log.setLevel(logging.INFO)

_ch = logging.StreamHandler(sys.stderr)
_ch.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
log.addHandler(_ch)

class _JsonFmt(logging.Formatter):
    def format(self, r):
        e = {"ts": self.formatTime(r, "%Y-%m-%dT%H:%M:%S"), "lvl": r.levelname, "msg": r.getMessage()}
        for a in ("request_id", "user_id", "user_role", "client_ip", "error"):
            if v := getattr(r, a, None): e[a] = v
        if r.exc_info and r.exc_info[1]: e["exc"] = str(r.exc_info[1])
        return json.dumps(e, ensure_ascii=False)

_fh = RotatingFileHandler(str(LOG_DIR / "app.log"), encoding="utf-8", maxBytes=10*1024*1024, backupCount=5)
_fh.setFormatter(_JsonFmt())
log.addHandler(_fh)
