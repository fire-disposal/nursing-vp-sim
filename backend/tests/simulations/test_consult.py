"""Expert consultation: budget/time, known-info summary, provider wiring."""

from typing import TYPE_CHECKING, cast

from modules.simulations import engine as e
from modules.simulations.case import CONSULT_COST
from modules.simulations.engine import build_consult_summary, new_session
from modules.simulations.service import SimulationService
from modules.simulations.state import state_from_dict, state_to_dict


def test_consult_deducts_budget_and_time():
    s = new_session()
    ok, _ = e.apply_action(s, "CONSULT", None)
    assert ok
    assert s.current_time == 2
    assert s.consult_count == 1
    assert s.diag_spent == CONSULT_COST


def test_consult_rejected_when_insufficient_budget():
    s = new_session()
    e.apply_action(s, "ORDER", "us")  # 120
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "ORDER", "us")  # +120 -> 240
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "ORDER", "abg")  # +60 -> 300; consult needs 120 > 100 remaining
    ok, msgs = e.apply_action(s, "CONSULT", None)
    assert not ok
    assert any("检查点不足" in m.text for m in msgs)
    assert s.consult_count == 0
    assert s.diag_spent == 300


def test_consult_summary_only_contains_known_info():
    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT", "cbc")
    e.apply_action(s, "VIEW", "cbc")
    e.apply_action(s, "DIAG", "疑诊术后出血")
    summary = build_consult_summary(s)
    assert "生命体征" in summary
    assert "hr=84" in summary  # vitals values are present (factual, lowercase)
    assert "血常规(CBC)" in summary
    assert "疑诊术后出血" in summary
    assert "severity" not in summary
    assert "0.12" not in summary  # hidden start severity never leaks
    assert "sampled_severity" not in summary


if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from models.simulation import SimulationSession


def _act_through_service(s, provider):
    session = _FakeSessionRow(s)
    service = SimulationService(cast("Session", _FakeDb()))
    messages, accepted = service.act(cast("SimulationSession", session), "CONSULT", None, consult_provider=provider)
    updated = state_from_dict(session.state)
    return messages, accepted, updated


def test_service_appends_provider_advice():
    s = new_session()

    def fake_provider(summary):
        return "评估：生命体征尚平稳；建议：复查 CBC 并监测尿量。"

    _, accepted, updated = _act_through_service(s, fake_provider)
    assert accepted
    assert updated.consult_count == 1
    assert updated.diag_spent == CONSULT_COST  # not refunded
    assert any("专家建议" in m.text for m in updated.public_log)
    # The advice must also be returned to the client this request (display bug fix).
    msgs, _, _ = _act_through_service(new_session(), fake_provider)
    assert any("专家建议" in m.text for m in msgs)


def test_service_refunds_when_provider_fails():
    s = new_session()

    def boom_provider(summary):
        raise RuntimeError("llm down")

    _, accepted, updated = _act_through_service(s, boom_provider)
    assert accepted
    assert updated.diag_spent == 0  # refunded
    assert any("不扣检查点" in m.text for m in updated.public_log)


def test_service_refunds_when_no_provider():
    s = new_session()
    _, accepted, updated = _act_through_service(s, None)
    assert accepted
    assert updated.diag_spent == 0
    assert any("服务未就绪" in m.text for m in updated.public_log)


class _FakeDb:
    def add(self, obj):
        pass

    def flush(self):
        pass

    def commit(self):
        pass

    def rollback(self):
        pass

    def get(self, model, pk):
        return None


class _FakeSessionRow:
    def __init__(self, state):
        self.id = 1
        self.user_id = 1
        self.case_version = "mvpb-1"
        self.status = state.case_status
        self.state = state_to_dict(state)
