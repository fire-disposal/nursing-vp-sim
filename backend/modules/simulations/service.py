"""Persistence + public-snapshot whitelist for simulation sessions.

The engine stays pure; this service owns the DB boundary and decides exactly
what the API may see. ``build_snapshot`` deliberately excludes the hidden
clinical state, any unrevealed CBC values, and the internal ``sampled_severity``
(MVP-B §4.4 / §9.1).
"""

from collections.abc import Callable

from sqlalchemy.orm import Session

from core.exceptions import NotFoundError
from core.unit_of_work import unit_of_work
from models.simulation import SimulationSession

from .case import CASE_VERSION, CONSULT_COST, DIAG_BUDGET_START, LAB_KINDS, TREAT_BUDGET_START, clock_text
from .engine import apply_action, build_consult_summary, new_session
from .state import DomainMessage, SessionState, state_from_dict, state_to_dict

ConsultProvider = Callable[[str], str]


def build_snapshot(session_id: int, state: SessionState) -> dict:
    pending = [t for t in state.pending_tasks if t.status == "PROCESSING"]
    revealed = [r for r in state.records if r.revealed]
    return {
        "session_id": session_id,
        "revision": state.revision,
        "case_status": state.case_status,
        "current_time": state.current_time,
        "clock": clock_text(state.current_time),
        "monitoring": state.hidden.monitoring_enabled,
        "reported": state.hidden.reported_to_doctor,
        "messages": [m.__dict__ for m in state.public_log],
        "vitals": [v.__dict__ for v in state.vitals],
        "drain": [d.__dict__ for d in state.drain],
        "pain": [p.__dict__ for p in state.pain],
        "urine": [u.__dict__ for u in state.urine],
        "pending": [
            {
                "id": t.id,
                "kind": t.kind,
                "label": LAB_KINDS[t.kind].label,
                "sampled_at": t.sampled_at,
                "due_at": t.due_at,
                "due_clock": clock_text(t.due_at),
            }
            for t in pending
        ],
        "lab_records": [
            {
                "order_id": r.order_id,
                "kind": r.kind,
                "label": LAB_KINDS[r.kind].label,
                "sampled_at": r.sampled_at,
                "ready_at": r.ready_at,
                "result": {k: v for k, v in r.result.items() if k != "sampled_severity"},
                "abnormal": r.result.get("abnormal", False),
            }
            for r in revealed
        ],
        "unrevealed_lab_count": sum(1 for r in state.records if not r.revealed),
        "cbc_count": state.cbc_count,
        "diag_spent": state.diag_spent,
        "diag_budget": max(0, DIAG_BUDGET_START - state.diag_spent),
        "treat_spent": state.treat_spent,
        "treat_budget": max(0, TREAT_BUDGET_START - state.treat_spent),
        "case_ended_at": state.case_ended_at,
    }


class SimulationService:
    def __init__(self, db: Session):
        self.db = db

    def create(self, user_id: int) -> SimulationSession:
        state = new_session()
        session = SimulationSession(
            user_id=user_id,
            case_version=CASE_VERSION,
            status=state.case_status,
            state=state_to_dict(state),
        )
        with unit_of_work(self.db, conflict_detail="创建模拟会话冲突"):
            self.db.add(session)
            self.db.flush()
        return session

    def get_owned(self, session_id: int, user_id: int) -> SimulationSession:
        session = self.db.get(SimulationSession, session_id)
        if session is None or session.user_id != user_id:
            raise NotFoundError("模拟会话不存在")
        return session

    def act(
        self,
        session: SimulationSession,
        action_type: str,
        target: str | None,
        consult_provider: ConsultProvider | None = None,
    ) -> tuple[list, bool]:
        state = state_from_dict(session.state)
        accepted, messages = apply_action(state, action_type, target)
        if accepted and action_type == "CONSULT":
            self._run_consult(state, messages, consult_provider)
        session.state = state_to_dict(state)
        session.status = state.case_status
        with unit_of_work(self.db, conflict_detail="保存模拟会话冲突"):
            self.db.flush()
        return messages, accepted

    def _run_consult(
        self, state: SessionState, messages: list[DomainMessage], provider: ConsultProvider | None
    ) -> None:
        """Call the expert AI with the player's known info; refund on failure."""
        if provider is None:
            state.diag_spent = max(0, state.diag_spent - CONSULT_COST)
            state.public_log.append(DomainMessage("SYSTEM", state.current_time, "专家会诊服务未就绪，本次不扣检查点。"))
            return
        try:
            advice = provider(build_consult_summary(state))
            state.public_log.append(DomainMessage("MONITOR", state.current_time, f"专家建议：{advice}"))
        except Exception:  # noqa: BLE001 — provider is an external boundary; any failure refunds
            state.diag_spent = max(0, state.diag_spent - CONSULT_COST)
            state.public_log.append(DomainMessage("SYSTEM", state.current_time, "专家会诊暂时不可用，本次不扣检查点。"))
