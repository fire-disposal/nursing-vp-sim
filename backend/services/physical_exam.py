"""Physical exam service — exam operation endpoint business logic."""

import logging

from sqlalchemy.orm import Session

from core.exceptions import AuthError, NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from contexts.training.capabilities import is_enabled
from models import Case, TrainingRecord, User
from profiles.history_taking.exam import handle_operation

log = logging.getLogger(__name__)

# op_type → SceneState vitals field mapping
_VITALS_MAP: dict[str, tuple[str, ...]] = {
    "hr": ("hr",),
    "bp": ("bp_sys", "bp_dia"),
    "rr": ("rr",),
    "spo2": ("spo2",),
    "temp": ("temp",),
    "pain": ("pain",),
}


def _vitals_patch(op_type: str, value: str) -> dict:
    """Convert an exam result into a SceneState vitals patch."""
    if op_type not in _VITALS_MAP:
        return {}
    fields = _VITALS_MAP[op_type]
    patch: dict[str, float | int] = {}
    if op_type == "bp":
        try:
            parts = value.split("/")
            patch["bp_sys"] = int(parts[0])
            patch["bp_dia"] = int(parts[1])
        except (ValueError, IndexError):
            return {}
    else:
        try:
            val = float(value)
            patch[fields[0]] = int(val) if op_type in ("hr", "rr", "pain") else val
        except ValueError:
            return {}
    return patch


class PhysicalExamService:
    def __init__(self, db: Session):
        self.db = db

    def perform(self, record_id: int, op_type: str, current_user: User) -> dict:
        """Execute an exam operation, update runtime_state, return response body.

        Raises NotFoundError / AuthError / ValidationError on guard failure.
        """
        record = self.db.query(TrainingRecord).filter(TrainingRecord.id == record_id).with_for_update().first()
        if not record:
            raise NotFoundError(detail="训练记录不存在")
        if record.user_id != current_user.id:
            raise AuthError(detail="只能操作自己的训练", status_code=403)
        if record.status != "in_progress":
            raise ValidationError(detail="训练已结束")
        # 单一真相门控：未开启护理查体能力则拒绝（此前后端完全不校验）
        if not is_enabled(record, "physical_exam"):
            raise ValidationError(detail="本次训练未启用护理查体")

        case = self.db.query(Case).filter(Case.id == record.case_id).first()
        if not case:
            raise NotFoundError(detail="病例不存在")

        result = handle_operation(op_type, case.case_data or {})

        rs = dict(record.runtime_state or {})
        exam_results = rs.get("exam_results", [])
        if not isinstance(exam_results, list):
            exam_results = []
        entry = {
            "type": op_type,
            "label": result.get("label", ""),
            "value": str(result.get("value", "")),
            "unit": result.get("unit", ""),
        }
        exam_results.append(entry)
        rs["exam_results"] = exam_results

        vitals_patch = _vitals_patch(op_type, str(result.get("value", "")))
        if vitals_patch:
            rs.setdefault("scene", {}).setdefault("vitals", {}).update(vitals_patch)

        record.runtime_state = rs

        with unit_of_work(self.db, conflict_detail="体检操作冲突"):
            self.db.flush()

        return {
            "type": op_type,
            "data": result,
            "all_results": exam_results,
            "vitals_patch": vitals_patch,  # D-2
        }
