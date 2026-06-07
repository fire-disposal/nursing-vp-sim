"""Unit tests for Phase parsing and transition logic."""

from services.pipeline.phase import (
    Phase,
    get_phase_by_order,
    parse_phase,
    parse_phases,
    try_advance_phase,
)


class TestParsePhase:
    def test_parse_minimal_phase(self):
        data = {"id": "test_phase"}
        phase = parse_phase(data)
        assert phase.id == "test_phase"
        assert phase.name == "test_phase"
        assert phase.operations == ["chat"]
        assert phase.prompt_profile == "patient_chat"

    def test_parse_full_phase(self):
        data = {
            "id": "exam",
            "name": "查体",
            "description": "执行体格检查",
            "order": 2,
            "operations": ["chat", "vitals", "bp"],
            "prompt_profile": "patient_exam",
            "scoring_dimensions": ["查体完整性"],
            "transition": {"auto": False, "manual_label": "下一步", "min_messages": 3},
        }
        phase = parse_phase(data)
        assert phase.id == "exam"
        assert phase.name == "查体"
        assert phase.order == 2
        assert "bp" in phase.operations
        assert phase.is_auto_transition is False
        assert phase.manual_label == "下一步"
        assert phase.min_messages == 3

    def test_parse_phases_no_phases_key(self):
        case_data = {"name": "test"}
        phases = parse_phases(case_data)
        assert len(phases) == 1
        assert phases[0].id == "history_taking"

    def test_parse_phases_with_exam_anchors(self):
        case_data = {"exam_anchors": {"vital_signs": {}}}
        phases = parse_phases(case_data)
        assert "vitals" in phases[0].operations
        assert "bp" in phases[0].operations

    def test_parse_phases_multiple(self):
        case_data = {
            "phases": [
                {"id": "phase_1", "order": 1},
                {"id": "phase_2", "order": 2},
            ]
        }
        phases = parse_phases(case_data)
        assert len(phases) == 2
        assert phases[0].id == "phase_1"
        assert phases[1].id == "phase_2"

    def test_get_phase_by_order(self):
        phases = [
            Phase(id="a", order=1),
            Phase(id="b", order=2),
        ]
        assert get_phase_by_order(phases, 2).id == "b"
        assert get_phase_by_order(phases, 3) is None


class TestTryAdvancePhase:
    def _make_phase(self, **overrides):
        defaults = {
            "id": "p1",
            "order": 1,
            "transition": {"auto": False, "min_messages": 3},
        }
        defaults.update(overrides)
        return parse_phase(defaults)

    def test_no_advance_when_not_auto_nor_manual(self):
        p = self._make_phase()
        phases = [p, Phase(id="p2", order=2)]
        result = try_advance_phase(p, phases, message_count=5, operation_count=0)
        assert result is None

    def test_advance_when_manual_and_conditions_met(self):
        p = self._make_phase()
        phases = [p, Phase(id="p2", order=2)]
        result = try_advance_phase(p, phases, message_count=3, operation_count=0, manual_requested=True)
        assert result is not None
        assert result.id == "p2"

    def test_no_advance_when_below_min_messages(self):
        p = self._make_phase()
        phases = [p, Phase(id="p2", order=2)]
        result = try_advance_phase(p, phases, message_count=1, operation_count=0, manual_requested=True)
        assert result is None

    def test_no_advance_when_below_min_operations(self):
        p = self._make_phase(transition={"auto": False, "min_operations": 3})
        phases = [p, Phase(id="p2", order=2)]
        result = try_advance_phase(p, phases, message_count=10, operation_count=1, manual_requested=True)
        assert result is None

    def test_auto_advance_after_messages(self):
        p = self._make_phase(transition={"auto": True, "auto_after_messages": 3})
        phases = [p, Phase(id="p2", order=2)]
        result = try_advance_phase(p, phases, message_count=3, operation_count=0)
        assert result is not None
        assert result.id == "p2"

    def test_no_auto_advance_before_threshold(self):
        p = self._make_phase(transition={"auto": True, "auto_after_messages": 3})
        phases = [p, Phase(id="p2", order=2)]
        result = try_advance_phase(p, phases, message_count=2, operation_count=0)
        assert result is None

    def test_no_advance_when_last_phase(self):
        p = Phase(id="p1", order=1)
        phases = [p]
        result = try_advance_phase(p, phases, message_count=10, operation_count=0, manual_requested=True)
        assert result is None
