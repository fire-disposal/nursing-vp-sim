"""HTTP entry for the clinical reasoning simulation (MVP-B §9.1).

Reuses the shared auth dependency; the engine rules live only in the engine.
The expert consultation reuses the shared AI infrastructure layer
(``app.state.llm_client`` / ``infra.llm``) — profiles, retry, circuit breaker
and call logging are all inherited.
"""

import asyncio

from fastapi import APIRouter, Request

from core.deps import CurrentUser, DbSession
from infra.llm.client import CallContext
from schemas.simulation import (
    ActionResultResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    SimulationActionRequest,
    SimulationSnapshot,
)

from .prompts import EXPERT_CONSULT_SYSTEM
from .service import ConsultProvider, SimulationService, build_snapshot
from .state import state_from_dict

router = APIRouter(prefix="/api/simulations", tags=["临床推理模拟"])


@router.post("/sessions", response_model=SessionCreateResponse)
def create_session(db: DbSession, user: CurrentUser, body: SessionCreateRequest | None = None):
    case_id = body.case_id if body else None
    session = SimulationService(db).create(user.id, case_id=case_id)
    state = state_from_dict(session.state)
    return {"session_id": session.id, "snapshot": build_snapshot(session.id, state)}


@router.get("/sessions/{session_id}", response_model=SimulationSnapshot)
def get_session(session_id: int, db: DbSession, user: CurrentUser):
    session = SimulationService(db).get_owned(session_id, user.id)
    return build_snapshot(session.id, state_from_dict(session.state))


def _consult_provider(request: Request, user_id: int) -> ConsultProvider | None:
    """Sync bridge to the async shared LLM client (sync endpoints run in a
    worker thread, so a private event loop is safe here)."""
    llm_client = getattr(request.app.state, "llm_client", None)
    if llm_client is None:
        return None

    def provider(summary: str) -> str:
        async def _run() -> str:
            return await llm_client.call(
                [
                    {"role": "system", "content": EXPERT_CONSULT_SYSTEM},
                    {"role": "user", "content": summary},
                ],
                purpose="expert_consult",
                ctx=CallContext(purpose="expert_consult", user_id=user_id),
            )

        return asyncio.run(_run())

    return provider


@router.post("/sessions/{session_id}/actions", response_model=ActionResultResponse)
def post_action(session_id: int, body: SimulationActionRequest, request: Request, db: DbSession, user: CurrentUser):
    service = SimulationService(db)
    session = service.get_owned(session_id, user.id)
    provider = _consult_provider(request, user.id)
    messages, accepted = service.act(session, body.action.type, body.action.target, consult_provider=provider)
    state = state_from_dict(session.state)
    return {
        "session_id": session.id,
        "revision": state.revision,
        "accepted": accepted,
        "case_ended": state.case_status != "ACTIVE",
        "messages": [m.__dict__ for m in messages],
        "snapshot": build_snapshot(session.id, state),
    }
