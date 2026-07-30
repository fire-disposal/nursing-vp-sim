"""Simple template engine — ``{#var#}`` syntax, strict variable checking."""

import re

_VAR_RE = re.compile(r"\{#([^}#]+)#\}")


def render_template(template: str, **kwargs) -> str:
    def _replace(m: re.Match) -> str:
        var = m.group(1).strip()
        if var not in kwargs:
            raise RuntimeError(f"Template variable missing: '{var}'")
        return str(kwargs[var])

    try:
        return _VAR_RE.sub(_replace, template)
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"Template rendering error: {e}")


def validate_template_vars(template: str, allowed_vars: frozenset[str]) -> list[str]:
    """Check that all {#var#} references in *template* are in *allowed_vars*.

    Returns a list of unrecognised variable names (empty = valid).
    Useful in tests and CI to catch stale/renamed template variables early.
    """
    referenced = {m.group(1).strip() for m in _VAR_RE.finditer(template)}
    return sorted(referenced - allowed_vars)


__all__ = ["render_template", "validate_template_vars"]
