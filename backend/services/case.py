import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from core.case_schema import normalize_gender, validate_case_data
from core.exceptions import ConflictError
from core.unit_of_work import unit_of_work
from models import Case, Practice
from repositories.case import CaseRepository

log = logging.getLogger(__name__)


def _personality_label(p: dict) -> str:
    if not p:
        return ""
    parts = []
    map_lit = {"low": "低素养", "normal": "中等", "high": "高素养"}
    map_verb = {"terse": "寡言", "normal": "正常", "verbose": "絮叨"}
    map_anx = {"calm": "安宁", "normal": "平常", "anxious": "焦虑"}
    map_pat = {"low": "急躁", "normal": "正常", "high": "耐心"}
    if p.get("health_literacy"):
        parts.append(map_lit.get(p["health_literacy"], ""))
    if p.get("verbosity"):
        parts.append(map_verb.get(p["verbosity"], ""))
    if p.get("anxiety_trait"):
        parts.append(map_anx.get(p["anxiety_trait"], ""))
    if p.get("patience"):
        parts.append(map_pat.get(p["patience"], ""))
    return "·".join(filter(None, parts))


@dataclass
class CaseManageView:
    id: int
    name: str
    description: str | None
    training_type: str
    patient_name: str
    patient_age: int | None
    patient_gender: str
    chief_complaint: str
    time_limit: int
    difficulty: int
    patient_personality: str
    is_open: bool
    created_at: datetime
    training_count: int


class CaseService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = CaseRepository(db)

    def _manage_view(self, case: Case, training_count: int = 0) -> CaseManageView:
        cd = case.case_data or {}
        info = cd.get("patient_info", {})
        personality = cd.get("personality", {})
        return CaseManageView(
            id=case.id,
            name=case.name,
            description=case.description,
            training_type=case.training_type,
            patient_name=info.get("name", ""),
            patient_age=info.get("age"),
            patient_gender=normalize_gender(info.get("gender", "")),
            chief_complaint=cd.get("chief_complaint", ""),
            time_limit=cd.get("time_limit", 20),
            difficulty=cd.get("difficulty", 1),
            patient_personality=_personality_label(personality),
            is_open=case.is_open,
            created_at=case.created_at,
            training_count=training_count,
        )

    def list_brief(
        self,
        offset: int,
        limit: int,
        *,
        training_type: str | None = None,
        difficulty: int | None = None,
        name: str | None = None,
    ) -> tuple[list[Case], int]:
        return self.repo.list_brief(offset, limit, training_type=training_type, difficulty=difficulty, name=name)

    def list_manage(
        self,
        offset: int,
        limit: int,
        *,
        name: str | None = None,
        difficulty: int | None = None,
        training_type: str | None = None,
        is_open: bool | None = None,
    ) -> tuple[list[CaseManageView], int]:
        cases, total = self.repo.list_manage(
            offset, limit, name=name, difficulty=difficulty, training_type=training_type, is_open=is_open
        )
        training_counts = self.repo.training_counts([c.id for c in cases])
        views = [self._manage_view(c, training_counts.get(c.id, 0)) for c in cases]
        return views, total

    def get(self, case_id: int) -> Case:
        return self.repo.get_or_404(case_id, "病例不存在")

    def create(self, case_data: dict, user_id: int, user_role: str) -> CaseManageView:
        training_type = case_data.get("training_type", "history_taking")
        cd = validate_case_data(training_type, case_data, strict=True)
        case = Case(
            name=cd["name"],
            description=cd.get("description", ""),
            case_data=cd,
            training_type=training_type,
            difficulty=cd.get("difficulty", 1),
            time_limit_minutes=cd.get("time_limit", 20),
        )
        with unit_of_work(self.db, conflict_detail="病例创建冲突"):
            self.repo.add(case)
        log.info(
            f"病例创建: case_id={case.id} case_name={case.name}",
            extra={"user_id": user_id, "user_role": user_role},
        )
        return self._manage_view(case, 0)

    def update(self, case_id: int, case_data: dict, user_id: int, user_role: str) -> CaseManageView:
        case = self.repo.get_or_404(case_id, "病例不存在")
        training_type = case_data.get("training_type", "history_taking")
        cd = validate_case_data(training_type, case_data, strict=True)
        case.name = cd["name"]
        case.description = cd.get("description", "")
        case.case_data = cd
        case.training_type = training_type
        case.difficulty = cd.get("difficulty", 1)
        case.time_limit_minutes = cd.get("time_limit", 20)
        with unit_of_work(self.db, conflict_detail="病例更新冲突"):
            self.db.flush()
        log.info(
            f"病例编辑: case_id={case_id} case_name={case.name}",
            extra={"user_id": user_id, "user_role": user_role},
        )
        count = self.repo.training_count(case_id)
        return self._manage_view(case, count)

    def delete(self, case_id: int, user_id: int, user_role: str) -> None:
        case = self.repo.get_or_404(case_id, "病例不存在")
        if self.repo.has_practices(case_id):
            raise ConflictError(detail="该病例存在关联的练习，无法删除")
        count = self.repo.training_count(case_id)
        if count > 0:
            raise ConflictError(detail=f"该病例已有 {count} 条训练记录，无法删除。请先删除相关训练记录。")
        case_name = case.name
        with unit_of_work(self.db, conflict_detail="病例删除冲突"):
            self.repo.delete(case)
        log.info(
            f"病例删除: case_id={case_id} case_name={case_name}",
            extra={"user_id": user_id, "user_role": user_role},
        )

    def list_practices(self, case_id: int) -> list[Practice]:
        return self.repo.list_active_practices(case_id)
