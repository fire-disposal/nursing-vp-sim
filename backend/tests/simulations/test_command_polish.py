"""指令体系打磨 — 减少无效操作。

- /wait 落在检查就绪锚点 → 结果直出（含被打断场景与「已就绪但未查看」场景）；
- /assess、/order、/view 裸命令 → 列出各自可用项（与 /give 裸命令同款引导）。
"""

from modules.simulations import engine as e
from modules.simulations.engine import new_session


def test_bare_assess_lists_targets_with_duration():
    s = new_session()
    ok, _ = e.apply_action(s, "ASSESS", None)
    assert ok is True
    text = s.public_log[-1].text
    assert "评估目标" in text
    assert "/assess vitals  2min  生命体征" in text


def test_bare_order_lists_labs_with_cost():
    s = new_session()
    e.apply_action(s, "ORDER", None)
    text = s.public_log[-1].text
    assert "可申请检查" in text
    assert "C反应蛋白(CRP)" in text
    assert "35检查点" in text


def test_bare_view_lists_labs():
    s = new_session()
    e.apply_action(s, "VIEW", None)
    text = s.public_log[-1].text
    assert "可查看已返回检查" in text
    assert "/view CBC" in text


def test_wait_auto_reveals_target_lab():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT", "cbc")
    assert s.records[0].revealed is True
    assert any("自动查看" in m.text for m in s.public_log)
    assert any("Hb" in m.text for m in s.public_log)


def test_generic_wait_auto_reveals_lab_ready_anchor():
    s = new_session()
    e.apply_action(s, "ORDER", "abg")  # due 13
    e.apply_action(s, "WAIT", None)  # 停在 ABG READY 锚点
    assert s.records[0].revealed is True


def test_wait_auto_reveals_interrupting_lab_while_target_pending():
    s = new_session()
    e.apply_action(s, "ORDER", "abg")  # due 13
    e.apply_action(s, "ORDER", "cbc")  # due 23
    e.apply_action(s, "WAIT", "cbc")  # 被 ABG@13 打断 → 直出 ABG
    abg = next(r for r in s.records if r.kind == "ABG")
    assert abg.revealed is True
    assert any("乳酸" in m.text for m in s.public_log)
    # CBC 尚未就绪：没有记录，保持保密
    assert not any(r.kind == "CBC" for r in s.records)
    assert any("仍 pending" in m.text for m in s.public_log)


def test_wait_with_ready_but_unrevealed_lab_auto_reveals():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")  # 0->3 due 18
    for _ in range(8):
        e.apply_action(s, "ASSESS", "vitals")  # ->19，CBC 在评估中到期
    assert s.records[0].revealed is False
    e.apply_action(s, "WAIT", "cbc")  # 无 pending 但有未查看结果 → 直出
    assert s.records[0].revealed is True


def test_lab_ready_message_no_longer_instructs_manual_view():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT", "cbc")
    ready_msgs = [m.text for m in s.public_log if m.kind == "LAB" and "结果已返回" in m.text]
    assert ready_msgs
    assert "使用 /view" not in ready_msgs[0]


def test_view_after_auto_reveal_is_idempotent():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT", "cbc")
    e.apply_action(s, "VIEW", "cbc")
    assert s.records[0].revealed is True
    assert len(s.records) == 1  # 不产生重复记录
