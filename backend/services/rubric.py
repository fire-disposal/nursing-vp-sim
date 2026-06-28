"""Rubric business logic — CRUD + activate."""

from sqlalchemy.orm import Session

from core.exceptions import NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from models import Rubric
from repositories.rubric import load_active_rubric, validate_dimensions


class RubricService:
    def __init__(self, db: Session):
        self.db = db

    def list(self) -> list[Rubric]:
        return self.db.query(Rubric).order_by(Rubric.created_at.desc()).all()

    def get_active(self) -> Rubric:
        active = load_active_rubric()
        if not active:
            raise NotFoundError("没有激活的评分标准")
        return active

    def create(self, data: dict) -> Rubric:
        errors = validate_dimensions(data["dimensions"])
        if errors:
            raise ValidationError("; ".join(errors))
        rubric = Rubric(
            name=data["name"],
            version=data.get("version", "1.0"),
            description=data.get("description"),
            total_max=data.get("total_max", 100),
            raw_max=data.get("raw_max", 57),
            raw_scale=data.get("raw_scale", 3),
            dimensions=data["dimensions"],
        )
        with unit_of_work(self.db, conflict_detail="创建评分标准失败"):
            self.db.add(rubric)
            self.db.flush()
        self.db.refresh(rubric)
        return rubric

    def update(self, rubric_id: int, data: dict) -> Rubric:
        rubric = self.db.query(Rubric).filter(Rubric.id == rubric_id).first()
        if not rubric:
            raise NotFoundError("评分标准不存在")
        errors = validate_dimensions(data["dimensions"])
        if errors:
            raise ValidationError("; ".join(errors))
        with unit_of_work(self.db, conflict_detail="更新评分标准失败"):
            rubric.name = data["name"]
            rubric.version = data.get("version", rubric.version)
            rubric.description = data.get("description", rubric.description)
            rubric.total_max = data.get("total_max", rubric.total_max)
            rubric.raw_max = data.get("raw_max", rubric.raw_max)
            rubric.raw_scale = data.get("raw_scale", rubric.raw_scale)
            rubric.dimensions = data["dimensions"]
            self.db.flush()
        return rubric

    def delete(self, rubric_id: int) -> None:
        rubric = self.db.query(Rubric).filter(Rubric.id == rubric_id).first()
        if not rubric:
            raise NotFoundError("评分标准不存在")
        if rubric.is_active:
            raise ValidationError("不能删除当前激活的评分标准")
        with unit_of_work(self.db, conflict_detail="删除评分标准失败"):
            self.db.delete(rubric)

    def activate(self, rubric_id: int) -> None:
        rubric = self.db.query(Rubric).filter(Rubric.id == rubric_id).first()
        if not rubric:
            raise NotFoundError("评分标准不存在")
        with unit_of_work(self.db, conflict_detail="激活评分标准失败"):
            self.db.query(Rubric).update({"is_active": False})
            rubric.is_active = True
