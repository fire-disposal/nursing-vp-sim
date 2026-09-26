"""backfill class memberships (cohort_label / member_role) and assignment audience recipients

# Manual override reason: data_only

配套 ``ddl/b2c4d6e8f0a1``（expand）：只回填数据 + 建立两条**必须晚于回填**的唯一约束。

回填规则：

1. ``classes.cohort_label`` ← ``grades.name``（``grade_id`` 悬空/NULL 的保持 ``''``，
   由 ``scripts/audit-class-membership-assignment-audience.py`` 报告）。
2. ``user_class`` 去重：同一 ``(user_id, class_id)`` 只保留 ``joined_at`` 最早的一行
   （同刻按 ``id`` 小者优先），再去掉 ``class_id IS NULL`` 的哨兵/脏行。
3. ``user_class.member_role`` ← ``users.role.name``：``teacher`` → teacher，其余（含 student）
   → student。成员角色只有两种取值，非学生/教师的账号若历史上挂了班级，这里按 student
   落地并由审计脚本报告，不删数据（expand 步骤保留回滚源）。
4. ``assignments.audience_mode``：``student_ids`` 为非空 JSON 数组 → ``selected``，
   其余（NULL / ``[]`` / 脏值）→ ``class``（旧代码把 ``[]`` 与 NULL 同样当全班）。
5. ``assignment_recipients`` = 发布时受众快照：
   - ``class`` 模式 ← 该班当前 ``member_role='student'`` 成员；
   - ``selected`` 模式 ← ``student_ids`` 中仍然存在的用户；
   - 两者都并入「已有训练记录的用户」（``is_test = false``），避免已经开始练习的学生
     因名单/班级变动而从受众与分母里消失。

两条唯一约束（去重之后才可能建成）：

- ``uq_user_class_user_id_class_id``
- ``uq_classes_cohort_label_name``（旧 ``(grade_id, name)`` 唯一约束下不可能产生同 cohort 重名）

downgrade 会把受众反投影回 ``assignments.student_ids`` 并把 ``classes.grade_id`` 补齐
（否则后续 ddl downgrade 的 ``SET NOT NULL`` 会失败）：``selected`` → 名单数组，
``class`` → NULL（还原旧的「全班动态」口径）。

Revision ID: b2c4d6e8f0a2
Revises: b2c4d6e8f0a1
Create Date: 2026-09-25

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2c4d6e8f0a2"
down_revision: Union[str, Sequence[str], None] = "b2c4d6e8f0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1) cohort_label ← grades.name
    conn.execute(
        sa.text(
            """
            UPDATE classes c
            SET cohort_label = g.name
            FROM grades g
            WHERE c.grade_id = g.id
              AND c.cohort_label = ''
            """
        )
    )

    # 2) 同一 (user_id, class_id) 去重，保留 joined_at 最早（同刻取 id 最小）
    conn.execute(
        sa.text(
            """
            DELETE FROM user_class uc
            USING user_class keep
            WHERE uc.class_id IS NOT NULL
              AND keep.class_id IS NOT NULL
              AND uc.user_id = keep.user_id
              AND uc.class_id = keep.class_id
              AND (keep.joined_at < uc.joined_at
                   OR (keep.joined_at = uc.joined_at AND keep.id < uc.id))
            """
        )
    )

    # 3) 移除 class_id 为 NULL 的成员行（哨兵/脏数据；class_id 语义不成立）
    conn.execute(sa.text("DELETE FROM user_class WHERE class_id IS NULL"))

    # 4) member_role ← 账号角色
    conn.execute(
        sa.text(
            """
            UPDATE user_class uc
            SET member_role = CASE WHEN r.name = 'teacher' THEN 'teacher' ELSE 'student' END
            FROM users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.id = uc.user_id
            """
        )
    )

    # 5) audience_mode ← student_ids 是否非空数组
    conn.execute(
        sa.text(
            """
            UPDATE assignments
            SET audience_mode = CASE
                WHEN student_ids IS NOT NULL
                 AND jsonb_typeof(student_ids) = 'array'
                 AND jsonb_array_length(student_ids) > 0
                THEN 'selected'
                ELSE 'class'
            END
            """
        )
    )

    # 6) 受众快照 —— class 模式：该班当前学生成员
    conn.execute(
        sa.text(
            """
            INSERT INTO assignment_recipients (assignment_id, user_id)
            SELECT a.id, uc.user_id
            FROM assignments a
            JOIN user_class uc ON uc.class_id = a.class_id AND uc.member_role = 'student'
            JOIN users u ON u.id = uc.user_id
            WHERE a.audience_mode = 'class'
            ON CONFLICT DO NOTHING
            """
        )
    )

    # 7) 受众快照 —— selected 模式：student_ids 中仍然存在的用户（非数字脏值直接跳过）
    conn.execute(
        sa.text(
            """
            INSERT INTO assignment_recipients (assignment_id, user_id)
            SELECT a.id, r.user_id
            FROM assignments a
            CROSS JOIN LATERAL (
                SELECT t.txt::int AS user_id
                FROM jsonb_array_elements_text(a.student_ids) AS t(txt)
                WHERE t.txt ~ '^[0-9]{1,10}$'
            ) AS r
            JOIN users u ON u.id = r.user_id
            WHERE a.audience_mode = 'selected'
            ON CONFLICT DO NOTHING
            """
        )
    )

    # 8) 已有训练记录的用户并入受众（历史越界/已退班学生仍在分母内）
    conn.execute(
        sa.text(
            """
            INSERT INTO assignment_recipients (assignment_id, user_id)
            SELECT DISTINCT tr.assignment_id, tr.user_id
            FROM training_records tr
            JOIN assignments a ON a.id = tr.assignment_id
            WHERE tr.is_test = false
            ON CONFLICT DO NOTHING
            """
        )
    )

    # 9) 去重/回填之后才可建立的唯一约束
    op.create_unique_constraint("uq_user_class_user_id_class_id", "user_class", ["user_id", "class_id"])
    op.create_unique_constraint("uq_classes_cohort_label_name", "classes", ["cohort_label", "name"])


def downgrade() -> None:
    conn = op.get_bind()

    # 1) 撤掉本轮新增的唯一约束（结构回退由 ddl 迁移继续）
    op.drop_constraint("uq_classes_cohort_label_name", "classes", type_="unique")
    op.drop_constraint("uq_user_class_user_id_class_id", "user_class", type_="unique")

    # 2) 受众反投影回 assignments.student_ids
    #    selected → 名单数组（无受众行时保留列中原始值，最忠实的回滚）
    conn.execute(
        sa.text(
            """
            UPDATE assignments a
            SET student_ids = src.ids
            FROM (
                SELECT ar.assignment_id AS aid, jsonb_agg(ar.user_id ORDER BY ar.user_id) AS ids
                FROM assignment_recipients ar
                JOIN assignments a2 ON a2.id = ar.assignment_id
                WHERE a2.audience_mode = 'selected'
                GROUP BY ar.assignment_id
            ) AS src
            WHERE a.id = src.aid
            """
        )
    )
    #    class → NULL（旧口径：全班动态）
    conn.execute(sa.text("UPDATE assignments SET student_ids = NULL WHERE audience_mode = 'class'"))

    # 3) 还原 grade_id：cohort_label → grades.name（空标签落到「默认」），
    #    否则后续 ddl downgrade 的 SET NOT NULL 会失败
    conn.execute(
        sa.text(
            """
            INSERT INTO grades (name, created_at)
            SELECT DISTINCT COALESCE(NULLIF(c.cohort_label, ''), '默认'), now()
            FROM classes c
            WHERE c.grade_id IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM grades g
                  WHERE g.name = COALESCE(NULLIF(c.cohort_label, ''), '默认')
              )
            """
        )
    )
    conn.execute(
        sa.text(
            """
            UPDATE classes c
            SET grade_id = g.id
            FROM grades g
            WHERE c.grade_id IS NULL
              AND g.name = COALESCE(NULLIF(c.cohort_label, ''), '默认')
            """
        )
    )
