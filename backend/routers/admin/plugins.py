from fastapi import APIRouter

from plugins.manager import get_plugin_manager

router = APIRouter(prefix="/api/admin/plugins", tags=["admin-plugins"])


@router.get("")
async def list_plugins():
    pm = get_plugin_manager()
    return [
        {
            "id": p.id,
            "name": p.name,
            "feature_flag": p.feature_flag.key if p.feature_flag else None,
            "requires": p.requires,
            "middleware_count": len(p.get_middleware()),
            "has_hooks": {
                "on_record_create": True,
                "on_phase_change": True,
                "on_exam": True,
                "on_training_end": True,
                "on_score": True,
            },
            "meta": {
                "description": p.description,
            },
        }
        for p in pm._plugins.values()
    ]
