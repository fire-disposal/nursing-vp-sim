"""API Key 加密工具 —— Fernet 对称加密"""
import base64
import hashlib
from cryptography.fernet import Fernet
from config import KEY_ENCRYPTION_KEY

_ENCRYPTION_KEY = KEY_ENCRYPTION_KEY

def _derive_fernet() -> Fernet:
    if _ENCRYPTION_KEY:
        try:
            return Fernet(_ENCRYPTION_KEY.encode())
        except Exception:
            raise RuntimeError(
                "KEY_ENCRYPTION_KEY 不是有效的 Fernet 密钥（需 32 字节 base64）。\n"
                "可使用 python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" 生成"
            )
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
