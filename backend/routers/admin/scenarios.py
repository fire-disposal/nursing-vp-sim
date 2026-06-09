from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/admin/scenarios", tags=["admin-scenarios"])

_scenarios_store: dict[str, dict] = {}

@router.get("")
async def list_scenarios():
    return list(_scenarios_store.values())

@router.get("/{scenario_id}")
async def get_scenario(scenario_id: str):
    s = _scenarios_store.get(scenario_id)
    if not s:
        raise HTTPException(404, "场景不存在")
    return s

@router.post("")
async def create_scenario(data: dict):
    sid = data.get("id")
    if not sid:
        raise HTTPException(400, "缺少 id")
    _scenarios_store[sid] = data
    return data

@router.put("/{scenario_id}")
async def update_scenario(scenario_id: str, data: dict):
    _scenarios_store[scenario_id] = data
    return data

@router.delete("/{scenario_id}")
async def delete_scenario(scenario_id: str):
    _scenarios_store.pop(scenario_id, None)
    return {"ok": True}
