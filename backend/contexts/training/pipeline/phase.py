"""Phase model — training lifecycle stage definition."""

from dataclasses import dataclass, field


@dataclass
class Phase:
    """A single stage in the training lifecycle."""

    id: str
    name: str = ""
    description: str = ""
    order: int = 1
    operations: list[str] = field(default_factory=lambda: ["chat"])
    prompt_profile: str = "patient_chat"
    scoring_dimensions: list[str] = field(default_factory=list)
    transition: dict = field(default_factory=dict)

    @property
    def is_auto_transition(self) -> bool:
        return self.transition.get("auto", False)

    @property
    def manual_label(self) -> str | None:
        return self.transition.get("manual_label")

    @property
    def min_messages(self) -> int:
        return self.transition.get("min_messages", 0)

    @property
    def min_operations(self) -> int:
        return self.transition.get("min_operations", 0)

    @property
    def auto_after_messages(self) -> int:
        return self.transition.get("auto_after_messages", 9999)

    def supports_operation(self, op_type: str) -> bool:
        return "chat" in self.operations or op_type in self.operations


def parse_phase(data: dict) -> Phase:
    return Phase(
        id=data["id"],
        name=data.get("name", data["id"]),
        description=data.get("description", ""),
        order=data.get("order", 1),
        operations=data.get("operations", ["chat"]),
        prompt_profile=data.get("prompt_profile", "patient_chat"),
        scoring_dimensions=data.get("scoring_dimensions", []),
        transition=data.get("transition", {}),
    )


def parse_phases(case_data: dict, training_type: str | None = None) -> list[Phase]:
    """Parse phases from case_data, with fallback to default single-phase."""
    raw = case_data.get("phases", [])
    if raw:
        return sorted([parse_phase(p) for p in raw], key=lambda p: p.order)
    if training_type:
        from profiles.registry import get_profile
        profile = get_profile(training_type)
        return [Phase(**vars(pc)) for pc in profile.phases]
    return [_default_phase(case_data)]


def _default_phase(case_data: dict) -> Phase:
    ops = ["chat"]
    if case_data.get("exam_anchors"):
        ops.extend(["vitals", "bp", "temp", "spo2", "hr", "rr", "skin", "pain"])
    return Phase(
        id="history_taking",
        name="问诊",
        description="采集患者病史和症状信息",
        order=1,
        operations=ops,
        prompt_profile="patient_chat",
        scoring_dimensions=["沟通技能", "病史采集"],
        transition={"auto": True, "auto_after_messages": 9999},
    )


def get_phase_by_order(phases: list[Phase], order: int) -> Phase | None:
    for p in phases:
        if p.order == order:
            return p
    return None


def try_advance_phase(
    current: Phase,
    phases: list[Phase],
    message_count: int,
    operation_count: int,
    manual_requested: bool = False,
) -> Phase | None:
    """Check conditions and return next phase if ready to advance, else None."""
    t = current.transition

    if not t.get("auto", False) and not manual_requested:
        return None

    if t.get("min_messages", 0) > message_count:
        return None
    if t.get("min_operations", 0) > operation_count:
        return None
    if message_count < t.get("auto_after_messages", 9999):
        if not manual_requested:
            return None

    next_order = current.order + 1
    return get_phase_by_order(phases, next_order)
