"""Persistence + public-snapshot whitelist for simulation sessions.

The engine stays pure; this service owns the DB boundary and decides exactly
what the API may see. ``build_snapshot`` deliberately excludes the hidden
clinical state, any unrevealed CBC values, and the internal ``sampled_severity``
(MVP-B §4.4 / §9.1).
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy.orm import Session

from core.exceptions import ConflictError, NotFoundError
from core.statuses import SimulationStatus
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


@dataclass(frozen=True)
class _ProviderCall:
    """事务 A 之后待执行的一次外部调用。

    只携带调用所需的纯数据（在行锁内从已推进的 state 求出），provider 本身
    在事务与行锁之外才被调用 —— 外部调用绝不持有数据库连接。"""

    kind: str  # consult | talk | diagnosis
    at_minute: int  # 该动作的会话分钟：消息时标必须来自动作当时，而不是 provider 返回时
    summary: str = ""  # consult / talk：玩家已知观察摘要（绝不含隐藏病程）
    system: str = ""  # talk：患者/家属人设 system prompt
    line: str = ""  # talk：玩家原话
    role: str = ""  # talk：patient | family（决定兜底文案）
    prompt: str = ""  # diagnosis：诊断复盘 prompt


def _plan_calls(
    state: SessionState,
    action_type: str,
    target: str | None,
    text: str | None,
    *,
    accepted: bool,
    was_active: bool,
) -> list[_ProviderCall]:
    """在一次动作被应用后，列出需要外部 provider 完成的调用（事务 A 内，纯计算）。

    会诊/对话只在动作被接受时发生；诊断复盘只在病例本回合离开 ACTIVE 且玩家
    已记录诊断时发生（与引擎同一个 ``was_active`` 判定）。
    """
    calls: list[_ProviderCall] = []
    if accepted and action_type == "CONSULT":
        calls.append(_ProviderCall(kind="consult", at_minute=state.current_time, summary=build_consult_summary(state)))
    if accepted and action_type == "TALK":
        role = "patient" if (target or "").lower() == "patient" else "family"
        case = CASES[state.case_id]
        system = patient_talk_system(case.patient) if role == "patient" else family_talk_system(case.family_persona)
        calls.append(
            _ProviderCall(
                kind="talk",
                at_minute=state.current_time,
                summary=build_consult_summary(state),
                system=system,
                line=(text or "").strip(),
                role=role,
            )
        )
    if was_active and state.case_status != SimulationStatus.ACTIVE.value and state.diagnosis:
        case = CASES[state.case_id]
        calls.append(
            _ProviderCall(
                kind="diagnosis",
                at_minute=state.current_time,
                prompt=(
                    f"【护士的诊断】\n{state.diagnosis}\n\n"
                    f"【真实病情】\n{case.narrative.diag_hint}（{case.narrative.handover_task}）"
                ),
            )
        )
    return calls


def _perform_call(
    call: _ProviderCall,
    consult_provider: ConsultProvider | None,
    talk_provider: TalkProvider | None,
    diagnose_provider: DiagnoseProvider | None,
) -> tuple[list[DomainMessage], bool]:
    """在事务外执行一次外部调用，返回 ``(要落库的消息, 是否退还会诊检查点)``。

    provider 是外部边界：任何异常都降级为稳定文案（会诊退还检查点），绝不把异常
    带进状态，也不伪造 provider 的成功内容。
    """
    if call.kind == "consult":
        if consult_provider is None:
            return [DomainMessage("SYSTEM", call.at_minute, "专家会诊服务未就绪，本次不扣检查点。")], True
        try:
            advice = consult_provider(call.summary)
        except Exception:  # noqa: BLE001 — provider is an external boundary; any failure refunds
            log.warning("专家会诊失败，已退还检查点: session_minute=%s", call.at_minute, exc_info=True)
            return [DomainMessage("SYSTEM", call.at_minute, "专家会诊暂时不可用，本次不扣检查点。")], True
        return [DomainMessage("MONITOR", call.at_minute, f"专家建议：{advice}")], False

    if call.kind == "talk":
        fallback = (
            "（患者虚弱，未能听清，稍作休息后望向护士。）"
            if call.role == "patient"
            else "（家属摇摇头：具体我也不太清楚，您多费心看看。）"
        )
        if talk_provider is None:
            return [DomainMessage("TALK", call.at_minute, fallback)], False
        try:
            reply = talk_provider(call.system, call.summary, call.line)
        except Exception:  # noqa: BLE001 — LLM boundary; any failure degrades gracefully
            log.warning("患者/家属对话失败，使用兜底文案: session_minute=%s", call.at_minute, exc_info=True)
            return [DomainMessage("TALK", call.at_minute, fallback)], False
        return [DomainMessage("TALK", call.at_minute, reply)], False

    # diagnosis：评分是增强项，无 provider 或失败都静默跳过（诊断本身已在 audit summary 展示）
    if diagnose_provider is None:
        return [], False
    try:
        verdict = diagnose_provider(call.prompt)
    except Exception:  # noqa: BLE001 — scoring is an enhancement; never breaks the outcome
        log.warning("诊断复盘失败，已跳过: session_minute=%s", call.at_minute, exc_info=True)
        return [], False
    return [DomainMessage("AUDIT", call.at_minute, f"诊断复盘：{verdict}")], False


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
        - **事务 A**：对会话行加锁并重读 state，在一个事务内完成 幂等键校验 →
          revision CAS → 确定性转移（apply_action）→ 落库并提交。行锁在此释放。
        - **事务外**：会诊/对话/诊断复盘 provider 在提交之后才被调用，既不持有
          事务也不持有行锁（docs/16 §4.5：不在长时间外部调用期间持有事务）。
        - **事务 B**：外部产物（回复文案、退还会诊检查点）通过第二个短事务落库；
          期间重新加锁并重读 state，把消息追加到最新状态上（不覆盖并发动作）。
        - ``idem_key`` 已应用过 → 不推进状态、不调用 provider，返回 ``replayed=True``，
          客户端用 snapshot 重绘；
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

        was_active = state.case_status == SimulationStatus.ACTIVE.value
        accepted, messages = apply_action(state, action_type, target, text)
        calls = _plan_calls(state, action_type, target, text, accepted=accepted, was_active=was_active)
        # revision 已由 engine.apply_action 在被接受时推进（状态版本），此处不再重复自增，
        # 只负责把它作为乐观并发基准与幂等键的归属版本记录下来。
        if idem_key is not None:
            state.idem_keys[idem_key] = state.revision
            while len(state.idem_keys) > IDEM_KEY_LIMIT:
                state.idem_keys.pop(next(iter(state.idem_keys)), None)

        # ── 事务 A：确定性转移 + 幂等/revision CAS 落库 ──
        # commit 在这一行结束：行锁与事务不再跨越任何外部 provider 调用。
        session.state = state_to_dict(state)
        with unit_of_work(self.db, conflict_detail="保存模拟会话冲突"):
            self.db.flush()
        if not calls:
            return messages, accepted, False

        # ── 事务外：会诊/对话/诊断复盘 provider 不持有事务与行锁 ──
        external: list[DomainMessage] = []
        refund_consult = False
        for call in calls:
            produced, refund = _perform_call(call, consult_provider, talk_provider, diagnose_provider)
            external.extend(produced)
            refund_consult = refund_consult or refund

        # ── 事务 B：短事务把外部回复/退还落库后才返回 ──
        if external or refund_consult:
            self._persist_external_effects(session, external, refund_consult=refund_consult)
        return messages + external, accepted, False

    def _persist_external_effects(
        self, session: SimulationSession, messages: list[DomainMessage], *, refund_consult: bool
    ) -> None:
        """事务 B：把事务外调用的产物追加进 ``public_log``（必要时退还会诊检查点）。

        provider 调用期间可能有别的动作推进了 revision，所以这里必须重新加锁并重读
        state，在**最新** state 上追加 —— 而不是覆盖，否则会丢掉那次动作。会话在
        外部调用期间消失 → ``NotFoundError``（明确报错，绝不静默丢弃回复）。
        """
        locked = self._lock_for_act(session)
        state = state_from_dict(locked.state)
        if refund_consult:
            state.diag_spent = max(0, state.diag_spent - CONSULT_COST)
        state.public_log.extend(messages)
        locked.state = state_to_dict(state)
        with unit_of_work(self.db, conflict_detail="保存模拟会话冲突"):
            self.db.flush()
