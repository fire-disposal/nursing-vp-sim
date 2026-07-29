"""
PromptContext — typed registry of prompt template data sources.

Each source registers under a named namespace so the assembly is
transparent and debuggable.  ``as_dict()`` flattens everything into
the single key-value map that ``render_template(**kwargs)`` expects.

Usage in prompt_builder::

    ctx = PromptContext()
    ctx.register("case", cached)         # flattens → {patient_name, chief_complaint, …}
    ctx.register("author", {"author_note": note})
    ctx.register("scene", {"scene_state": text})

    render_template(template, **ctx.as_dict())
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PromptContext:
    sources: dict[str, dict] = field(default_factory=dict)

    def register(self, namespace: str, data: dict | None) -> None:
        """Register a block of variables under *namespace*.

        ``None`` data is silently skipped so callers can avoid ``if`` guards.
        """
        if data is None:
            return
        self.sources[namespace] = data

    def as_dict(self) -> dict[str, str]:
        """Flatten all registered namespaces into a single kwarg dict.

        Later namespaces override earlier ones on key collision.
        """
        result: dict[str, str] = {}
        for ns, data in self.sources.items():
            result.update(data)
        return result

    @property
    def namespaces(self) -> list[str]:
        return list(self.sources.keys())

    def __bool__(self) -> bool:
        return bool(self.sources)
