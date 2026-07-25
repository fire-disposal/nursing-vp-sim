from cryptography.fernet import Fernet

from core.config import FERNET_KEY

from .client import CallContext, LLMClient
from .logging import LogWorker
from .parsing import safe_parse_json
from .router import ProfileRouter, _SyntheticConfig, get_env_fallback_state

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(FERNET_KEY.encode())
    return _fernet


def encrypt_api_key(raw: str) -> str:
    return _get_fernet().encrypt(raw.encode()).decode()


def decrypt_api_key(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()


__all__ = [
    "CallContext",
    "LLMClient",
    "LogWorker",
    "ProfileRouter",
    "_SyntheticConfig",
    "decrypt_api_key",
    "encrypt_api_key",
    "get_env_fallback_state",
    "safe_parse_json",
]
