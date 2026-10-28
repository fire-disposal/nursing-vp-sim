"""学生身份（院校内学号）唯一性 —— 唯一实现，写入侧共用。

一个院校里同一个学号只能对应一个学生账号：账号只是登录凭据，训练记录、日志、问卷都挂在
账号上，同一学号出现两个账号就会把同一个人的历史劈成两半（2026-10 线上：郑悦霄、
王雨佳各两个账号，20 / 14 条已完成训练留在了旧账号上）。

这条不变量不落数据库约束：管理/教师账号历史上也用 ``student_id`` 存内部编号（线上有 4 个
admin 共用同一个值），「仅学生、仅本校」的偏唯一索引不是普通唯一索引能表达的；把它写成
触发器或生成列属于为约束加机制。读写都只需要一个判据，就放在这里：
``register``、``PATCH/PUT /admin/users/{id}``、批量导入的预检/提交共用同一份。
"""

from sqlalchemy.orm import Session

from core.exceptions import ValidationError
from models import Role, User

STUDENT_ROLE_NAME = "student"


def normalize_student_id(raw: object) -> str | None:
    """学号归一：去空白，空串 = 没填（不是「空学号」这个值）。"""
    text = str(raw or "").strip()
    return text or None


def find_student_conflict(
    db: Session, *, school_id: int | None, student_id: str | None, exclude_user_id: int | None = None
) -> User | None:
    """本校同学号的另一个**学生**账号；没有则 None。

    平台账号（``school_id`` 为空）不参与：它不属于任何院校，学号无从比较。
    """
    sid = normalize_student_id(student_id)
    if sid is None or school_id is None:
        return None
    query = (
        db.query(User)
        .join(Role, Role.id == User.role_id)
        .filter(
            Role.name == STUDENT_ROLE_NAME,
            User.school_id == school_id,
            User.student_id == sid,
        )
    )
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    return query.first()


def assert_student_identity_free(
    db: Session, *, school_id: int | None, student_id: str | None, exclude_user_id: int | None = None
) -> None:
    """冲突即拒绝，并把「和谁冲突」写进错误里：管理员要能直接找到那个账号。"""
    conflict = find_student_conflict(db, school_id=school_id, student_id=student_id, exclude_user_id=exclude_user_id)
    if conflict is not None:
        raise ValidationError(
            f"学号 {normalize_student_id(student_id)} 已被账号「{conflict.username}（{conflict.display_name}）」使用"
        )
