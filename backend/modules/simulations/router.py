"""HTTP entry for the clinical reasoning simulation (MVP-B §9.1).

Reuses the shared auth dependency; the engine rules live only in the engine.
"""

from fastapi import APIRouter

from core.deps import CurrentUser, DbSession
from schemas.simulation import (
    ActionResultResponse,
    SessionCreateResponse,
    SimulationActionRequest,
    SimulationSnapshot,
)

from .service import SimulationService, build_snapshot
from .state import state_from_dict

router = APIRouter(prefix="/api/simulations", tags=["临床推理模拟"])


@router.post("/sessions", response_model=SessionCreateResponse)
def create_session(db: DbSession, user: CurrentUser):
    session = SimulationService(db).create(user.id)
    state = state_from_dict(session.state)
    return {"session_id": session.id, "snapshot": build_snapshot(session.id, state)}


@router.get("/sessions/{session_id}", response_model=SimulationSnapshot)
def get_session(session_id: int, db: DbSession, user: CurrentUser):
    session = SimulationService(db).get_owned(session_id, user.id)
    return build_snapshot(session.id, state_from_dict(session.state))


@router.post("/sessions/{session_id}/actions", response_model=ActionResultResponse)
def post_action(session_id: int, body: SimulationActionRequest, db: DbSession, user: CurrentUser):
    service = SimulationService(db)
    session = service.get_owned(session_id, user.id)
    messages, accepted = service.act(session, body.action.type, body.action.target)
    state = state_from_dict(session.state)
    return {
        "session_id": session.id,
        "revision": state.revision,
        "accepted": accepted,
        "case_ended": state.case_status != "ACTIVE",
        "messages": [m.__dict__ for m in messages],
        "snapshot": build_snapshot(session.id, state),
    }
