"""API Key 加密工具 —— Fernet 对称加密（由 FERNET_KEY 环境变量驱动）"""

from cryptography.fernet import Fernet

from core.config import FERNET_KEY

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
