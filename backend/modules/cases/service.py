import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from fastapi import Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.exceptions import ConflictError, NotFoundError
from core.time_limits import DEFAULT_TIME_LIMIT_MINUTES
from core.unit_of_work import unit_of_work
from models import (
    CASE_STATUS_ARCHIVED,
    CASE_STATUS_DRAFT,
    CASE_STATUS_PUBLISHED,
    Assignment,
    Case,
    CaseRevision,
    TrainingRecord,
)
from modules.cases.gate import (
    CaseNotPublishableError,
    validate_candidate,
    validate_case_row,
)
from modules.cases.revisions import (
    append_revision,
    content_matches_current_revision,
    require_editable,
)
from modules.cases.validator import CaseReport
from modules.training.workflows import case_is_startable, workflow_for_case
from schemas.case_schema import normalize_gender, strip_case_metadata, validate_case_data

log = logging.getLogger(__name__)


def _personality_label(p: dict) -> str:
    if not p:
        return ""
    parts = []
    map_lit = {"low": "低素养", "normal": "中等", "medium": "中等", "high": "高素养"}
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
    status: str
    current_revision_id: int | None
    current_revision_no: int | None
    patient_name: str
    patient_age: int | None
    patient_gender: str
    chief_complaint: str
    time_limit: int
    difficulty: int
    patient_personality: str
    capabilities: dict
    is_open: bool
    created_at: datetime
    training_count: int


@dataclass(slots=True)
class CaseListFilters:
    """教师病例库列表 / 导出的筛选（唯一事实来源）。

    以 `Depends()` 注入，两个端点拿到同一份参数定义：
    后端不会各自声明、也不会出现"新增筛选只加了一边"的漂移。
    """

    name: Annotated[str | None, Query(description="病例名称模糊搜索")] = None
    difficulty: Annotated[int | None, Query(ge=1, le=3, description="困难程度 1=初级 2=中级 3=高级")] = None
    status: Annotated[str | None, Query(description="生命周期筛选(draft/published/archived)；缺省不含归档")] = None
    is_open: Annotated[bool | None, Query(description="是否向学生开放")] = None


class CaseService:
    def __init__(self, db: Session):
        self.db = db

    def training_count(self, case_id: int) -> int:
        """病例的训练记录数（Phase 5 自 repo 内联迁移）。"""
        return self.db.query(TrainingRecord).filter(TrainingRecord.case_id == case_id).count()

    def _manage_view(self, case: Case, training_count: int = 0) -> CaseManageView:
        cd = case.case_data or {}
        info = cd.get("patient_info", {})
        personality = cd.get("personality", {})
        return CaseManageView(
            id=case.id,
            name=case.name,
            description=case.description,
            status=case.status,
            current_revision_id=case.current_revision_id,
            current_revision_no=case.current_revision_no,
            patient_name=info.get("name", ""),
            patient_age=info.get("age"),
            patient_gender=normalize_gender(str(info.get("gender") or "")) or "",
            chief_complaint=cd.get("chief_complaint", ""),
            # 元数据单一读源：列（case_data 中的同名字段仅作写入输入，落库前即剥离）
            time_limit=case.time_limit_minutes,
            difficulty=case.difficulty,
            patient_personality=_personality_label(personality),
            # 能力由病例声明的 activities.* 解析（与学生端 /api/cases 同源），按病例
            # current revision 所属 workflow 解析，不读库里的存储字段、不读代码常量
            capabilities=workflow_for_case(case).resolve_features(cd),
            is_open=case.is_open,
            created_at=case.created_at,
            training_count=training_count,
        )

    def list_brief(
        self,
        offset: int,
        limit: int,
        *,
        difficulty: int | None = None,
        name: str | None = None,
    ) -> tuple[list[Case], int]:
        """学生目录：只出现**可开始训练**的已发布开放病例（docs/15 §六/§十六）。

        学生工作区未交付的 workflow（``runtime_ready=False``）整类隐藏 —— 目录是产品面，
        不是路线图；"可见但点不动"会把未交付的能力暴露给学生。

        过滤放在 Python 侧（病例量级为数十）：workflow 的判定 owner 是
        ``workflows.case_is_startable``，在 SQL 里重写一份 ``case_data->>'workflow'``
        的等价条件会形成第二处判定、迟早漂移。
        """
        q = self.db.query(Case).filter(Case.is_open == True, Case.status == CASE_STATUS_PUBLISHED).order_by(Case.id)
        if difficulty is not None:
            q = q.filter(Case.difficulty == difficulty)
        if name:
            q = q.filter(Case.name.ilike(f"%{name}%"))
        startable = [case for case in q.all() if case_is_startable(case)]
        return startable[offset : offset + limit], len(startable)

    def list_manage(self, filters: CaseListFilters, *, offset: int, limit: int) -> tuple[list[CaseManageView], int]:
        """教师病例库。默认不含已归档病例（archived 只作为历史检索入口）。"""
        # current_revision 供视图展示版本号：连带加载，避免逐行懒加载（N+1）
        q = self.db.query(Case).options(joinedload(Case.current_revision)).order_by(Case.created_at.desc())
        q = q.filter(Case.status == filters.status) if filters.status else q.filter(Case.status != CASE_STATUS_ARCHIVED)
        if filters.is_open is not None:
            q = q.filter(Case.is_open == filters.is_open)
        if filters.name:
            q = q.filter(Case.name.ilike(f"%{filters.name}%"))
        if filters.difficulty is not None:
            q = q.filter(Case.difficulty == filters.difficulty)
        total = q.order_by(None).count()
        cases = q.offset(offset).limit(limit).all()
        case_ids = [c.id for c in cases]
        if case_ids:
            rows = (
                self.db.query(TrainingRecord.case_id, func.count(TrainingRecord.id))
                .filter(TrainingRecord.case_id.in_(case_ids))
                .group_by(TrainingRecord.case_id)
                .all()
            )
            training_counts = {cid: cnt for cid, cnt in rows}
        else:
            training_counts = {}
        views = [self._manage_view(c, training_counts.get(c.id, 0)) for c in cases]
        return views, total

    def get(self, case_id: int) -> Case:
        case = self.db.query(Case).options(joinedload(Case.current_revision)).filter(Case.id == case_id).first()
        if case is None:
            raise NotFoundError("病例不存在")
        return case

    def revisions(self, case_id: int) -> list[CaseRevision]:
        """病例的版本历史（新→旧）；内容不可变，仅供查看与回滚参照。"""
        case = self.get(case_id)
        return (
            self.db.query(CaseRevision)
            .filter(CaseRevision.case_id == case.id)
            .order_by(CaseRevision.revision_no.desc())
            .all()
        )

    def create(self, case_data: dict, user_id: int, user_role: str, *, is_open: bool = True) -> CaseManageView:
        """新建病例 = draft：内容先落工作副本，发布（含门禁）产生第一个 revision。"""
        cd = validate_case_data(case_data, strict=True)
        case = Case(
            name=cd["name"],
            description=cd.get("description", ""),
            case_data=strip_case_metadata(cd),
            status=CASE_STATUS_DRAFT,
            difficulty=cd.get("difficulty", 1),
            time_limit_minutes=cd.get("time_limit") or DEFAULT_TIME_LIMIT_MINUTES,
            is_open=is_open,
        )
        with unit_of_work(self.db, conflict_detail="病例创建冲突"):
            self.db.add(case)
            self.db.flush()
        log.info(
            f"病例创建: case_id={case.id} case_name={case.name}",
            extra={"user_id": user_id, "user_role": user_role},
        )
        return self._manage_view(case, 0)

    def update(self, case_id: int, case_data: dict, user_id: int, user_role: str) -> CaseManageView:
        """编辑工作副本。

        已发布病例的编辑必须先过发布门禁（字段级 error 即 422，不落库），内容变化则追加
        新 revision —— 旧训练永远按旧版复盘（docs/15 §六）。已归档病例内容冻结。
        """
        case = self.get(case_id)
        require_editable(case)
        cd = validate_case_data(case_data, strict=True)
        payload = strip_case_metadata(cd)
        name = cd["name"]
        # 元数据缺省 = 不改（避免一次编辑把 difficulty/time_limit 静默改回默认值）
        difficulty = cd.get("difficulty", case.difficulty)
        time_limit = cd.get("time_limit") or case.time_limit_minutes
        content_changed = payload != strip_case_metadata(case.case_data or {})

        if case.status == CASE_STATUS_PUBLISHED:
            report = validate_candidate(payload, name=name, difficulty=difficulty, time_limit=time_limit)
            if report.errors:
                raise CaseNotPublishableError(case, report)

        with unit_of_work(self.db, conflict_detail="病例更新冲突"):
            case.name = name
            case.description = cd.get("description", "")
            case.case_data = payload
            case.difficulty = difficulty
            case.time_limit_minutes = time_limit
            if case.status == CASE_STATUS_PUBLISHED and content_changed:
                append_revision(self.db, case, user_id=user_id)
            self.db.flush()
        log.info(
            f"病例编辑: case_id={case_id} case_name={case.name}",
            extra={"user_id": user_id, "user_role": user_role},
        )
        count = (self.db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.case_id == case_id).scalar()) or 0
        return self._manage_view(case, count)

    def publish(self, case_id: int, user_id: int, user_role: str) -> tuple[CaseManageView, CaseReport]:
        """发布门禁 + 版本落地（docs/15 §六）。

        门禁复用 CI 病例审计的同一份校验器（modules/cases/validator.py）：有 error 即
        拒绝发布（422 + 字段级报告），警告只随报告返回。内容与 current revision 一致
        （例如元数据微调）时不产生多余版本。
        """
        case = self.get(case_id)
        require_editable(case)
        report = validate_case_row(case)
        if report.errors:
            log.warning(
                "病例发布被门禁拒绝: case_id=%d errors=%d", case_id, len(report.errors), extra={"user_id": user_id}
            )
            raise CaseNotPublishableError(case, report)
        with unit_of_work(self.db, conflict_detail="病例发布冲突"):
            if not content_matches_current_revision(case):
                revision = append_revision(self.db, case, user_id=user_id)
                log.info(
                    f"病例发布: case_id={case_id} revision_no={revision.revision_no}",
                    extra={"user_id": user_id, "user_role": user_role},
                )
            else:
                case.status = CASE_STATUS_PUBLISHED
            self.db.flush()
        count = (self.db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.case_id == case_id).scalar()) or 0
        return self._manage_view(case, count), report

    def archive(self, case_id: int, user_id: int, user_role: str) -> CaseManageView:
        """归档：只阻止新使用（作业/训练），不删除历史 revision 与既有训练。"""
        case = self.get(case_id)
        with unit_of_work(self.db, conflict_detail="病例归档冲突"):
            case.status = CASE_STATUS_ARCHIVED
            self.db.flush()
        log.info(f"病例归档: case_id={case_id}", extra={"user_id": user_id, "user_role": user_role})
        return self._manage_view(case, self.training_count(case_id))

    def delete(self, case_id: int, user_id: int, user_role: str) -> None:
        case = self.get(case_id)
        count = (self.db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.case_id == case_id).scalar()) or 0
        if count > 0:
            raise ConflictError(detail=f"该病例已有 {count} 条训练记录，无法删除。请先删除相关训练记录。")
        assignments = self.db.query(func.count(Assignment.id)).filter(Assignment.case_id == case_id).scalar() or 0
        if assignments > 0:
            raise ConflictError(detail=f"该病例已被 {assignments} 个作业引用，无法删除。请先删除相关作业。")
        case_name = case.name
        with unit_of_work(self.db, conflict_detail="病例删除冲突"):
            self.db.delete(case)
            self.db.flush()
        log.info(
            f"病例删除: case_id={case_id} case_name={case_name}",
            extra={"user_id": user_id, "user_role": user_role},
        )

    def set_open(self, case_id: int, is_open: bool) -> Case:
        """学生目录可见性开关（与 status 正交）。

        未发布/已归档病例不能「向学生开放」—— 开放动作只有在 published 上才有意义，
        否则会得到「已开放但学生看不到」的静默状态。
        """
        case = self.get(case_id)
        if is_open and case.status != CASE_STATUS_PUBLISHED:
            raise ConflictError(detail="病例尚未发布，无法向学生开放；请先发布")
        case.is_open = is_open
        with unit_of_work(self.db, conflict_detail="切换开放状态冲突"):
            self.db.flush()
        return case
