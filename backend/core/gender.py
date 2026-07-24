"""Gender value normalization — single source of truth for the entire system.

Internal canonical form is the Chinese pair ``"男"`` / ``"女"`` with ``None``
for unknown / unspecified.  All input variants (English, abbreviations, mixed
case, whitespace) are normalized to this form.

Usage::

    from core.gender import normalize_gender, display_gender, GENDER_MALE, GENDER_FEMALE

    normalize_gender("male")   # → "男"
    normalize_gender("女性")   # → "女"
    normalize_gender(None)     # → None
    display_gender("男")       # → "男"
    display_gender(None)       # → "未知"
"""

from __future__ import annotations

# ── Constants ────────────────────────────────────────────────────────────────

GENDER_MALE = "男"
GENDER_FEMALE = "女"

_MALE_INPUTS = frozenset({"男", "男性", "male", "m", "boy", "man", "1"})
_FEMALE_INPUTS = frozenset({"女", "女性", "female", "f", "girl", "woman", "2"})

_DISPLAY_MAP: dict[str | None, str] = {
    GENDER_MALE: "男",
    GENDER_FEMALE: "女",
    None: "未知",
    "": "未知",
}

# ── Public API ──────────────────────────────────────────────────────────────


def normalize_gender(value: str | None) -> str | None:
    """Normalise any supported gender string to ``"男"`` / ``"女"``.

    Returns ``None`` for empty, unknown, or ``None`` input.
    """
    if not value:
        return None
    v = value.strip().lower()
    if v in _MALE_INPUTS:
        return GENDER_MALE
    if v in _FEMALE_INPUTS:
        return GENDER_FEMALE
    return None


def display_gender(value: str | None) -> str:
    """Human-readable display label (Chinese)."""
    return _DISPLAY_MAP.get(value or None, "未知")
