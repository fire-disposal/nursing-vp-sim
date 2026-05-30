"""API Key 加密工具 —— Fernet 对称加密"""
import base64
import hashlib
import os
from cryptography.fernet import Fernet

_ENV_KEY = os.getenv("KEY_ENCRYPTION_KEY", "")

def _derive_fernet() -> Fernet:
    if _ENV_KEY:
        return Fernet(_ENV_KEY.encode())
    from config import SECRET_KEY
    raw = hashlib.sha256(SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))

_fernet: Fernet | None = None

def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = _derive_fernet()
    return _fernet

def encrypt_api_key(raw: str) -> str:
    return _get_fernet().encrypt(raw.encode()).decode()

def decrypt_api_key(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()
