"""Persistence + public-snapshot whitelist for simulation sessions.

The engine stays pure; this service owns the DB boundary and decides exactly
what the API may see. ``build_snapshot`` deliberately excludes the hidden
clinical state, any unrevealed CBC values, and the internal ``sampled_severity``
(MVP-B §4.4 / §9.1).
"""

import logging
from collections.abc import Callable

from sqlalchemy.orm import Session

from core.exceptions import ConflictError, NotFoundError
from core.unit_of_work import unit_of_work
from models.simulation import SimulationSession

log = logging.getLogger(__name__)

from .case import (
    CASE_VERSION,
    CASES,
    CONSULT_COST,
    DIAG_BUDGET_START,
    TREAT_BUDGET_START,
    clock_text,
)
from .engine import apply_action, build_consult_summary, new_session
from .prompts import family_talk_system, patient_talk_system
from .state import IDEM_KEY_LIMIT, DomainMessage, SessionState, state_from_dict, state_to_dict

ConsultProvider = Callable[[str], str]
TalkProvider = Callable[[str, str, str], str]  # (system, known_summary, player_line) -> persona reply
DiagnoseProvider = Callable[[str], str]  # (review_prompt) -> scoring verdict


def build_snapshot(session_id: int, state: SessionState) -> dict:
    pending = [t for t in state.pending_tasks if t.status == "PROCESSING"]
    revealed = [r for r in state.records if r.revealed]
    case = CASES[state.case_id]
    return {
        "session_id": session_id,
        "revision": state.revision,
        "case_status": state.case_status,
        "case_meta": {
            "id": state.case_id,
            "name": case.name,
            "version": state.case_id,
            "start_clock": case.start_clock,
        },
        "cases": [
            {"id": cid, "name": c.name, "version": cid, "start_clock": c.start_clock} for cid, c in CASES.items()
        ],
        "surface": {
            "assessments": dict(case.surface.assessments),
            "drugs": dict(case.surface.drugs),
            "labs": {k: s.label for k, s in case.resources.lab_kinds.items()},
            "talk_roles": list(case.surface.talk_roles),
            "wait_labs": case.surface.wait_labs,
            "monitor": case.surface.monitor,
        },
        "current_time": state.current_time,
        "clock": clock_text(state.current_time, case.start_clock),
        "monitoring": state.hidden.monitoring_enabled,
        "reported": state.hidden.reported_to_doctor,
        "diagnosis": state.diagnosis,
        "messages": [m.__dict__ for m in state.public_log],
        # Legacy fixed keys (frontend compat) + generic map for any target.
        "vitals": [v.__dict__ for v in state.readings.get("vitals", [])],
        "drain": [d.__dict__ for d in state.readings.get("drain", [])],
        "pain": [p.__dict__ for p in state.readings.get("pain", [])],
        "urine": [u.__dict__ for u in state.readings.get("urine", [])],
        "readings": {k: [r.__dict__ for r in v] for k, v in state.readings.items()},
        "pending": [
            {
                "id": t.id,
                "kind": t.kind,
                "label": case.resources.lab_kinds[t.kind].label,
                "sampled_at": t.sampled_at,
                "due_at": t.due_at,
                "due_clock": clock_text(t.due_at, case.start_clock),
            }
            for t in pending
        ],
        "lab_records": [
            {
                "order_id": r.order_id,
                "kind": r.kind,
                "label": case.resources.lab_kinds[r.kind].label,
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

    def create(self, user_id: int, case_id: str | None = None) -> SimulationSession:
        cid = case_id or CASE_VERSION
        if cid not in CASES:
            raise NotFoundError("未知病例")
        state = new_session(cid)
        session = SimulationSession(
            user_id=user_id,
            case_version=cid,
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

    def _lock_for_act(self, session: SimulationSession) -> SimulationSession:
        """锁住会话行并重读 state，再交给 CAS/幂等/落库使用。

        ``populate_existing`` 不可省：identity map 里已有该对象时，SQLAlchemy 默认
        会丢弃锁查询的结果、继续用请求开头读到的旧属性，锁就成了摆设——两个
        请求仍会各自基于同一 revision 提交。fake session（测试替身）没有行锁
        语义，原样返回，既有测试语义不变。
        """
        if not isinstance(self.db, Session):
            return session
        locked = self.db.get(SimulationSession, session.id, with_for_update=True, populate_existing=True)
        if locked is None:
            raise NotFoundError("模拟会话不存在")
        return locked

    def act(
        self,
        session: SimulationSession,
        action_type: str,
        target: str | None,
        text: str | None = None,
        consult_provider: ConsultProvider | None = None,
        talk_provider: TalkProvider | None = None,
        diagnose_provider: DiagnoseProvider | None = None,
        *,
        expected_revision: int | None = None,
        idem_key: str | None = None,
    ) -> tuple[list, bool, bool]:
        """应用一个动作，返回 ``(messages, accepted, replayed)``。

        并发语义（与训练工具面同一套：乐观并发 + 幂等键）：
        - 先对会话行加锁并重读 state，校验/应用/落库在同一把行锁内完成；
        - ``idem_key`` 已应用过 → 不再推进状态，返回 ``replayed=True``，客户端用 snapshot 重绘；
        - ``expected_revision`` 与当前 revision 不符 → 409（双击/双标签/重发不会静默叠加）；
        - 接受的动作用于推进 ``revision``，使下一次 CAS 有意义。
        """
        session = self._lock_for_act(session)
        state = state_from_dict(session.state)

        if idem_key is not None and idem_key in state.idem_keys:
            log.info("模拟动作幂等重放: session_id=%s key=%s", session.id, idem_key)
            return [], True, True

        if expected_revision is not None and expected_revision != state.revision:
            raise ConflictError(
                detail=f"会话状态已变化（期望 revision={expected_revision}，当前={state.revision}），请刷新后重试"
            )

        was_active = state.case_status == "ACTIVE"
        accepted, messages = apply_action(state, action_type, target, text)
        if accepted and action_type == "CONSULT":
            self._run_consult(state, messages, consult_provider)
        if accepted and action_type == "TALK":
            self._run_talk(state, messages, target, text, talk_provider)
        if was_active and state.case_status != "ACTIVE" and state.diagnosis:
            self._run_diagnosis_review(state, messages, diagnose_provider)
        # revision 已由 engine.apply_action 在被接受时推进（状态版本），此处不再重复自增，
        # 只负责把它作为乐观并发基准与幂等键的归属版本记录下来。
        if idem_key is not None:
            state.idem_keys[idem_key] = state.revision
            while len(state.idem_keys) > IDEM_KEY_LIMIT:
                state.idem_keys.pop(next(iter(state.idem_keys)), None)

        session.state = state_to_dict(state)
        session.status = state.case_status
        with unit_of_work(self.db, conflict_detail="保存模拟会话冲突"):
            self.db.flush()
        return messages, accepted, False

    def _run_talk(
        self,
        state: SessionState,
        messages: list[DomainMessage],
        target: str | None,
        text: str | None,
        provider: TalkProvider | None,
    ) -> None:
        """Call the persona LLM with the player's line; append its reply.

        Like consult, the persona only ever sees the player's known
        observations (build_consult_summary) — never the hidden course.
        On provider failure a neutral fallback line keeps the session usable.
        """
        role = "patient" if (target or "").lower() == "patient" else "family"
        case = CASES[state.case_id]
        system = patient_talk_system(case.patient) if role == "patient" else family_talk_system(case.family_persona)
        summary = build_consult_summary(state)
        line = (text or "").strip()
        fallback = (
            "（患者虚弱，未能听清，稍作休息后望向护士。）"
            if role == "patient"
            else "（家属摇摇头：具体我也不太清楚，您多费心看看。）"
        )
        if provider is None:
            msg = DomainMessage("TALK", state.current_time, fallback)
            messages.append(msg)
            state.public_log.append(msg)
            return
        try:
            reply = provider(system, summary, line)
            msg = DomainMessage("TALK", state.current_time, reply)
            messages.append(msg)
            state.public_log.append(msg)
        except Exception:  # noqa: BLE001 — LLM boundary; any failure degrades gracefully
            msg = DomainMessage("TALK", state.current_time, fallback)
            messages.append(msg)
            state.public_log.append(msg)

    def _run_consult(
        self, state: SessionState, messages: list[DomainMessage], provider: ConsultProvider | None
    ) -> None:
        """Call the expert AI with the player's known info; refund on failure.

        Appends the outcome to BOTH ``messages`` (returned to the client this
        request) and ``state.public_log`` (persisted for reload), so the console
        always shows the advice / refund notice immediately.
        """
        if provider is None:
            msg = DomainMessage("SYSTEM", state.current_time, "专家会诊服务未就绪，本次不扣检查点。")
            state.diag_spent = max(0, state.diag_spent - CONSULT_COST)
            messages.append(msg)
            state.public_log.append(msg)
            return
        try:
            advice = provider(build_consult_summary(state))
            msg = DomainMessage("MONITOR", state.current_time, f"专家建议：{advice}")
            messages.append(msg)
            state.public_log.append(msg)
        except Exception:  # noqa: BLE001 — provider is an external boundary; any failure refunds
            state.diag_spent = max(0, state.diag_spent - CONSULT_COST)
            msg = DomainMessage("SYSTEM", state.current_time, "专家会诊暂时不可用，本次不扣检查点。")
            messages.append(msg)
            state.public_log.append(msg)

    def _run_diagnosis_review(
        self, state: SessionState, messages: list[DomainMessage], provider: DiagnoseProvider | None
    ) -> None:
        """Score the player's recorded diagnosis against the real condition.

        Runs exactly once when the case transitions out of ACTIVE. The real
        condition is the case's diag_hint + handover_task — no hidden vitals,
        so the review judges the diagnosis but never leaks lab values.
        """
        if provider is None:
            return  # 无 LLM 时静默跳过；诊断本身已在 audit summary 展示
        case = CASES[state.case_id]
        prompt = (
            f"【护士的诊断】\n{state.diagnosis}\n\n"
            f"【真实病情】\n{case.narrative.diag_hint}（{case.narrative.handover_task}）"
        )
        try:
            verdict = provider(prompt)
            msg = DomainMessage("AUDIT", state.current_time, f"诊断复盘：{verdict}")
            messages.append(msg)
            state.public_log.append(msg)
        except Exception:  # noqa: BLE001 — scoring is an enhancement; never breaks the outcome
            return
