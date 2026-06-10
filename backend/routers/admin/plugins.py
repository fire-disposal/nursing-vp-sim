from fastapi import APIRouter

from contexts.training.pipeline.plugin import get_all_plugins

router = APIRouter(prefix="/api/admin/plugins", tags=["admin-plugins"])

@router.get("")
async def list_plugins():
    from contexts.training.plugins import register_all_plugins
    register_all_plugins()
    return [
        {
            "id": p.id,
            "name": p.name,
            "feature_flag": p.feature_flag,
            "requires": p.requires,
            "middleware_count": len(p.middleware),
            "has_hooks": {
                "on_record_create": p.on_record_create is not None,
                "on_phase_change": p.on_phase_change is not None,
                "on_end": p.on_end is not None,
                "on_score": p.on_score is not None,
            },
            "meta": {
                "description": p.meta.description,
                "tags": p.meta.tags,
            },
        }
        for p in get_all_plugins()
    ]
