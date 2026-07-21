import logging
import logging.config
import sys
from typing import ClassVar


class _ColoredFormatter(logging.Formatter):
    _RESET: ClassVar[str] = "\033[0m"
    _COLORS: ClassVar[dict] = {
        logging.DEBUG: "\033[36m",
        logging.INFO: "\033[32m",
        logging.WARNING: "\033[33m",
        logging.ERROR: "\033[31m",
        logging.CRITICAL: "\033[35m",
    }
    _NAME_COLOR: ClassVar[str] = "\033[34m"

    def format(self, record):
        lvl_color = self._COLORS.get(record.levelno, "")
        record.levelname = f"{lvl_color}{record.levelname:<8}{self._RESET}"
        record.name = f"{self._NAME_COLOR}{record.name}{self._RESET}"
        return super().format(record)


def setup_logging():
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "()": "infrastructure.logging_setup._ColoredFormatter",
                    "format": "%(asctime)s.%(msecs)03d %(levelname)s %(name)s %(message)s",
                    "datefmt": "%H:%M:%S",
                },
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "stream": sys.stderr,
                    "formatter": "default",
                },
            },
            "root": {
                "level": "INFO",
                "handlers": ["console"],
            },
            "loggers": {
                "alembic": {"level": "WARNING"},
                "httpx": {"level": "WARNING"},
                "sqlalchemy.engine": {"level": "WARNING"},
                "httpcore": {"level": "WARNING"},
            },
        }
    )
