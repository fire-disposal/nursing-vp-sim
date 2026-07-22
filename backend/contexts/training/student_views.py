"""Student assignment list — thin router."""

from typing import Annotated

from fastapi import APIRouter, Depends

from core.deps import DbSession
from core.security import get_current_user
from models import User
from schemas import StudentAssignmentItem
from services.student import StudentService

router = APIRouter(prefix="/api/students/assignments", tags=["学生练习"])


@router.get("", response_model=list[StudentAssignmentItem])
def list_student_assignments(current_user: Annotated[User, Depends(get_current_user)], db: DbSession):
    return StudentService(db).list_assignments(current_user.id)
