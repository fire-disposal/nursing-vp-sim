from core.permissions import PERMISSION_KEYS

SYSTEM_PERMISSIONS: dict[str, list[str]] = {
    "super_admin": [
        "user_manage",
        "role_manage",
        "grade_class_manage",
        "case_manage",
        "training_access",
        "score_review",
        "stats_view",
        "qa_access",
        "llm_monitor",
        "api_manage",
        "assignment_manage",
        "feedback_review",
        "export_data",
        "record_notes",
        "questionnaire_manage",
    ],
    "school_admin": [
        "user_manage",
        "role_manage",
        "grade_class_manage",
        "case_manage",
        "training_access",
        "score_review",
        "stats_view",
        "qa_access",
        "llm_monitor",
        "assignment_manage",
        "feedback_review",
        "export_data",
        "record_notes",
        "questionnaire_manage",
    ],
    "teacher": [
        "grade_class_manage",
        "case_manage",
        "training_access",
        "qa_access",
        "score_review",
        "stats_view",
        "assignment_manage",
        "feedback_review",
        "export_data",
        "record_notes",
        "questionnaire_manage",
    ],
    "student": [
        "training_access",
        "qa_access",
    ],
}

SYSTEM_ROLES: list[tuple[str, str]] = [
    ("super_admin", "超级管理员"),
    ("school_admin", "学校管理员"),
    ("teacher", "教师"),
    ("student", "学生"),
]

_unknown = {p for perms in SYSTEM_PERMISSIONS.values() for p in perms} - set(PERMISSION_KEYS)
if _unknown:
    raise ValueError(f"roles.py 使用了未在 core/permissions.py 定义的权限: {sorted(_unknown)}")
