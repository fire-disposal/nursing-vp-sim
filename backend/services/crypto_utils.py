"""API Key 加密工具 —— Fernet 对称加密（由 SECRET_KEY 派生）"""

import base64
import hashlib

from cryptography.fernet import Fernet

from core.config import SECRET_KEY

_fernet: Fernet | None = None


def _derive_fernet() -> Fernet:
    raw = hashlib.sha256(SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = _derive_fernet()
    return _fernet


def encrypt_api_key(raw: str) -> str:
    return _get_fernet().encrypt(raw.encode()).decode()


def decrypt_api_key(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()
