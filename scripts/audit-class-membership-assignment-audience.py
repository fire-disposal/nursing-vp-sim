#!/usr/bin/env python3
"""class-membership / assignment-audience 只读盘点。

迁移前后都能跑（按库中实际存在的列/表自适应）：

  - ``user_class`` 重复 ``(user_id, class_id)``、``class_id IS NULL`` 悬空行；
  - 成员角色分布（历史表用账号角色推断；已迁移表另看 ``member_role`` 与账号角色是否一致）；
  - 一个用户所属班级数的分布（单用户多班级是否已经收敛）；
  - ``Grade`` → ``cohort`` 映射（``cohort_label`` 未回填、``grade_id`` 悬空、同 cohort 重名）；
  - ``assignments.student_ids`` 脏数据（非数组 / 空数组 / 非数字 / 指向不存在用户 / 不在该班学生成员里），
    以及已迁移库中 ``assignment_recipients`` 与旧名单的差异。

**只读**：不写任何表，不改任何结构。原始 SQL 直查遗留列（``grades`` / ``student_ids`` / ``grade_id``）
是本脚本的职责 —— 业务代码（ORM）已不再暴露这些名字。

用法：
  uv run python scripts/audit-class-membership-assignment-audience.py
  uv run python scripts/audit-class-membership-assignment-audience.py --json

退出码：0 = 无 error 级发现；1 = 存在 error 级发现（重复成员 / 悬空成员 / 重名 / student_ids 脏值）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import sqlalchemy as sa

from core.config import DATABASE_URL

SEV_LABEL = {"error": "ERROR", "warning": "WARN ", "info": "INFO "}
SAMPLE_LIMIT = 5


def _engine():
    url = DATABASE_URL
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return sa.create_engine(url, connect_args={"connect_timeout": 5})


def _has_table(conn, table: str) -> bool:
    return bool(
        conn.execute(
            sa.text("SELECT 1 FROM information_schema.tables WHERE table_name = :t"),
            {"t": table},
        ).scalar()
    )


def _has_column(conn, table: str, column: str) -> bool:
    return bool(
        conn.execute(
            sa.text(
                "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"
            ),
            {"t": table, "c": column},
        ).scalar()
    )


def _finding(check: str, severity: str, count: int, detail: str, samples: list | None = None) -> dict:
    return {
        "check": check,
        "severity": severity if count else "info",
        "count": count,
        "detail": detail,
        "samples": samples or [],
    }


def audit(conn) -> list[dict]:
    findings: list[dict] = []
    migrated = _has_column(conn, "user_class", "member_role")

    # ── 1. 重复 (user_id, class_id) ─────────────────────────────────────────────
    rows = conn.execute(
        sa.text(
            "SELECT user_id, class_id, count(*) AS c FROM user_class "
            "WHERE class_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY c DESC, user_id"
        )
    ).all()
    findings.append(
        _finding(
            "membership_duplicates",
            "error",
            len(rows),
            "同一 (user_id, class_id) 多行 —— 唯一约束建立前必须先按 joined_at 去重",
            [{"user_id": r[0], "class_id": r[1], "rows": r[2]} for r in rows[:SAMPLE_LIMIT]],
        )
    )

    # ── 2. class_id 悬空的成员行 ───────────────────────────────────────────────
    count = conn.execute(sa.text("SELECT count(*) FROM user_class WHERE class_id IS NULL")).scalar() or 0
    samples = conn.execute(
        sa.text("SELECT id, user_id, joined_at FROM user_class WHERE class_id IS NULL ORDER BY id LIMIT :n"),
        {"n": SAMPLE_LIMIT},
    ).all()
    findings.append(
        _finding(
            "membership_null_class",
            "error",
            count,
            "成员行没有班级 —— 不代表任何班级，迁移会移除（这里先盘点）",
            [{"id": r[0], "user_id": r[1], "joined_at": str(r[2])} for r in samples],
        )
    )

    # ── 3. 角色分布 ───────────────────────────────────────────────────────────
    rows = conn.execute(
        sa.text(
            "SELECT r.name, count(*) FROM user_class uc "
            "JOIN users u ON u.id = uc.user_id JOIN roles r ON r.id = u.role_id GROUP BY 1 ORDER BY 2 DESC"
        )
    ).all()
    findings.append(
        _finding(
            "member_account_roles",
            "info",
            sum(r[1] for r in rows),
            "成员账号的角色分布（历史角色口径）",
            [{"role": r[0], "members": r[1]} for r in rows],
        )
    )
    if migrated:
        rows = conn.execute(
            sa.text("SELECT member_role, count(*) FROM user_class GROUP BY 1 ORDER BY 2 DESC")
        ).all()
        findings.append(
            _finding(
                "member_role_distribution",
                "info",
                sum(r[1] for r in rows),
                "member_role 分布（已迁移：学生名单/受众候选取 student）",
                [{"member_role": r[0], "members": r[1]} for r in rows],
            )
        )
        count = conn.execute(
            sa.text(
                "SELECT count(*) FROM user_class uc JOIN users u ON u.id = uc.user_id "
                "JOIN roles r ON r.id = u.role_id "
                "WHERE uc.member_role <> CASE WHEN r.name = 'teacher' THEN 'teacher' ELSE 'student' END"
            )
        ).scalar() or 0
        samples = conn.execute(
            sa.text(
                "SELECT uc.id, uc.user_id, uc.class_id, uc.member_role, r.name FROM user_class uc "
                "JOIN users u ON u.id = uc.user_id JOIN roles r ON r.id = u.role_id "
                "WHERE uc.member_role <> CASE WHEN r.name = 'teacher' THEN 'teacher' ELSE 'student' END "
                "ORDER BY uc.id LIMIT :n"
            ),
            {"n": SAMPLE_LIMIT},
        ).all()
        findings.append(
            _finding(
                "member_role_vs_account_role",
                "warning",
                count,
                "member_role 与账号角色不一致（例如账号升为 teacher 但成员角色仍是 student）—— 需要人工确认",
                [
                    {"id": r[0], "user_id": r[1], "class_id": r[2], "member_role": r[3], "account_role": r[4]}
                    for r in samples
                ],
            )
        )

    # ── 4. 多班级分布 / 无班级用户 ─────────────────────────────────────────────
    rows = conn.execute(
        sa.text(
            "SELECT class_count, count(*) FROM ("
            "  SELECT user_id, count(DISTINCT class_id) AS class_count FROM user_class "
            "  WHERE class_id IS NOT NULL GROUP BY user_id"
            ") t GROUP BY 1 ORDER BY 1"
        )
    ).all()
    multi = sum(r[1] for r in rows if r[0] > 1)
    findings.append(
        _finding(
            "classes_per_user",
            "info",
            sum(r[1] for r in rows),
            f"每个用户的班级数分布；多班级用户 {multi} 人（单用户多班级模型下属于正常形态）",
            [{"classes": r[0], "users": r[1]} for r in rows],
        )
    )
    count = conn.execute(
        sa.text(
            "SELECT count(*) FROM users u WHERE NOT EXISTS "
            "(SELECT 1 FROM user_class uc WHERE uc.user_id = u.id AND uc.class_id IS NOT NULL)"
        )
    ).scalar() or 0
    findings.append(
        _finding(
            "users_without_class",
            "info",
            count,
            "没有任何班级的用户数（管理员/教师/未分班学生都算在内）",
        )
    )

    # ── 5. Grade → cohort 映射 ────────────────────────────────────────────────
    if _has_column(conn, "classes", "cohort_label"):
        count = conn.execute(sa.text("SELECT count(*) FROM classes WHERE cohort_label = ''")).scalar() or 0
        samples = conn.execute(
            sa.text(
                "SELECT id, name, grade_id FROM classes WHERE cohort_label = '' ORDER BY id LIMIT :n"
            ),
            {"n": SAMPLE_LIMIT},
        ).all()
        findings.append(
            _finding(
                "cohort_label_unfilled",
                "warning",
                count,
                "班级 cohort_label 为空 —— 迁移回填只认 grade_id，这些行落空（旧口径的「无年级」班级）",
                [{"class_id": r[0], "name": r[1], "grade_id": r[2]} for r in samples],
            )
        )
        rows = conn.execute(
            sa.text(
                "SELECT cohort_label, name, count(*) AS c FROM classes GROUP BY 1, 2 HAVING count(*) > 1 "
                "ORDER BY c DESC, name"
            )
        ).all()
        findings.append(
            _finding(
                "cohort_name_collisions",
                "error",
                len(rows),
                "同一 (cohort_label, name) 多行 —— 会阻塞 UNIQUE(cohort_label, name)",
                [{"cohort_label": r[0], "name": r[1], "classes": r[2]} for r in rows[:SAMPLE_LIMIT]],
            )
        )
    else:
        findings.append(
            _finding("cohort_label_unfilled", "info", 0, "classes.cohort_label 尚不存在（未迁移）"),
        )

    if _has_table(conn, "grades") and _has_column(conn, "classes", "grade_id"):
        rows = conn.execute(
            sa.text(
                "SELECT g.name, count(c.id) FROM grades g LEFT JOIN classes c ON c.grade_id = g.id "
                "GROUP BY 1 ORDER BY 2 DESC, 1"
            )
        ).all()
        findings.append(
            _finding(
                "grade_to_cohort_map",
                "info",
                sum(r[1] for r in rows),
                "Grade → cohort_label 映射（迁移把 grades.name 写入 classes.cohort_label）",
                [{"grade": r[0], "classes": r[1]} for r in rows],
            )
        )
        count = conn.execute(
            sa.text(
                "SELECT count(*) FROM classes c LEFT JOIN grades g ON g.id = c.grade_id "
                "WHERE c.grade_id IS NOT NULL AND g.id IS NULL"
            )
        ).scalar() or 0
        findings.append(
            _finding(
                "grade_id_dangling",
                "error",
                count,
                "classes.grade_id 指向不存在的年级 —— cohort_label 将回填为空",
            )
        )
        count = conn.execute(sa.text("SELECT count(*) FROM classes WHERE grade_id IS NULL")).scalar() or 0
        findings.append(
            _finding(
                "grade_id_null",
                "info",
                count,
                "classes.grade_id 为空的班级（迁移已把该列改为 nullable；新代码不再写入）",
            )
        )

    # ── 6. student_ids 脏数据 ─────────────────────────────────────────────────
    if _has_column(conn, "assignments", "student_ids"):
        rows = conn.execute(
            sa.text(
                "SELECT jsonb_typeof(student_ids) AS t, count(*) FROM assignments GROUP BY 1 ORDER BY 2 DESC"
            )
        ).all()
        findings.append(
            _finding(
                "student_ids_shape",
                "info",
                sum(r[1] for r in rows),
                "assignments.student_ids 形态分布（NULL / array / 其它脏值）",
                [{"type": str(r[0]), "assignments": r[1]} for r in rows],
            )
        )
        count = conn.execute(
            sa.text(
                "SELECT count(*) FROM assignments WHERE student_ids IS NOT NULL "
                "AND jsonb_typeof(student_ids) <> 'array'"
            )
        ).scalar() or 0
        findings.append(
            _finding(
                "student_ids_not_array",
                "error",
                count,
                "student_ids 不是 JSON 数组 —— 迁移按 class 模式处理，脏值直接忽略",
            )
        )
        count = conn.execute(
            sa.text(
                "SELECT count(*) FROM assignments WHERE jsonb_typeof(student_ids) = 'array' "
                "AND jsonb_array_length(student_ids) = 0"
            )
        ).scalar() or 0
        findings.append(
            _finding(
                "student_ids_empty_array",
                "info",
                count,
                "student_ids = [] —— 旧代码把空数组当「全班」，迁移同样按 class 模式处理",
            )
        )
        rows = conn.execute(
            sa.text(
                "SELECT a.id, t.txt FROM assignments a "
                "CROSS JOIN LATERAL jsonb_array_elements_text(a.student_ids) AS t(txt) "
                "WHERE jsonb_typeof(a.student_ids) = 'array' AND t.txt !~ '^[0-9]{1,10}$' LIMIT :n"
            ),
            {"n": SAMPLE_LIMIT},
        ).all()
        bad = conn.execute(
            sa.text(
                "SELECT count(*) FROM assignments a "
                "CROSS JOIN LATERAL jsonb_array_elements_text(a.student_ids) AS t(txt) "
                "WHERE jsonb_typeof(a.student_ids) = 'array' AND t.txt !~ '^[0-9]{1,10}$'"
            )
        ).scalar() or 0
        findings.append(
            _finding(
                "student_ids_non_numeric",
                "error",
                bad,
                "student_ids 里有非数字元素 —— 迁移会跳过它们（不会因此失败）",
                [{"assignment_id": r[0], "value": r[1]} for r in rows],
            )
        )
        count = conn.execute(
            sa.text(
                "SELECT count(*) FROM assignments a "
                "CROSS JOIN LATERAL jsonb_array_elements_text(a.student_ids) AS t(txt) "
                "WHERE jsonb_typeof(a.student_ids) = 'array' AND t.txt ~ '^[0-9]{1,10}$' "
                "AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.txt::int)"
            )
        ).scalar() or 0
        findings.append(
            _finding(
                "student_ids_missing_users",
                "warning",
                count,
                "student_ids 指向已不存在的用户（FK 不允许，迁移会丢弃）",
            )
        )
        # 两条完全静态的 SQL（含/不含 member_role 条件），避免拼接查询串
        not_member_sql_migrated = sa.text(
            "SELECT count(*) FROM assignments a "
            "CROSS JOIN LATERAL jsonb_array_elements_text(a.student_ids) AS t(txt) "
            "WHERE jsonb_typeof(a.student_ids) = 'array' AND t.txt ~ '^[0-9]{1,10}$' "
            "AND EXISTS (SELECT 1 FROM users u WHERE u.id = t.txt::int) "
            "AND NOT EXISTS (SELECT 1 FROM user_class uc WHERE uc.user_id = t.txt::int "
            "AND uc.class_id = a.class_id AND uc.member_role = 'student')"
        )
        not_member_sql_legacy = sa.text(
            "SELECT count(*) FROM assignments a "
            "CROSS JOIN LATERAL jsonb_array_elements_text(a.student_ids) AS t(txt) "
            "WHERE jsonb_typeof(a.student_ids) = 'array' AND t.txt ~ '^[0-9]{1,10}$' "
            "AND EXISTS (SELECT 1 FROM users u WHERE u.id = t.txt::int) "
            "AND NOT EXISTS (SELECT 1 FROM user_class uc WHERE uc.user_id = t.txt::int "
            "AND uc.class_id = a.class_id)"
        )
        count = conn.execute(not_member_sql_migrated if migrated else not_member_sql_legacy).scalar() or 0
        findings.append(
            _finding(
                "student_ids_not_class_members",
                "warning",
                count,
                "指定名单里的用户已不是该班学生成员 —— 迁移仍会把他们留在受众里（不让已发布作业的受众缩水）",
            )
        )
        if _has_table(conn, "assignment_recipients"):
            count = conn.execute(
                sa.text(
                    "SELECT count(*) FROM assignments a "
                    "CROSS JOIN LATERAL jsonb_array_elements_text(a.student_ids) AS t(txt) "
                    "WHERE jsonb_typeof(a.student_ids) = 'array' AND t.txt ~ '^[0-9]{1,10}$' "
                    "AND a.audience_mode = 'selected' "
                    "AND NOT EXISTS (SELECT 1 FROM assignment_recipients r WHERE r.assignment_id = a.id "
                    "AND r.user_id = t.txt::int)"
                )
            ).scalar() or 0
            findings.append(
                _finding(
                    "recipients_missing_from_student_ids",
                    "info",
                    count,
                    "已迁移库里，指定模式旧名单有用户不在受众快照中（正常：用户已删除；否则说明受众被改过）",
                )
            )
    else:
        findings.append(_finding("student_ids_shape", "info", 0, "assignments.student_ids 已不存在（contract 完成）"))

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="class membership / assignment audience 只读盘点")
    parser.add_argument("--json", action="store_true", help="机器可读 JSON 输出")
    args = parser.parse_args()

    engine = _engine()
    with engine.connect() as conn:
        findings = audit(conn)

    errors = sum(1 for f in findings if f["severity"] == "error" and f["count"])
    warnings = sum(1 for f in findings if f["severity"] == "warning" and f["count"])

    if args.json:
        print(json.dumps({"findings": findings, "errors": errors, "warnings": warnings}, ensure_ascii=False, indent=1))
    else:
        for f in findings:
            line = f"[{SEV_LABEL[f['severity']]}] {f['check']:<32} {f['count']!s:>6}  {f['detail']}"
            print(line)
            for s in f["samples"]:
                print(f"           - {s}")
        print()
        print(f"error={errors} warning={warnings}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
