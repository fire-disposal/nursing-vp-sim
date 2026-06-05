SYSTEM_PERMISSIONS: dict[str, list[str]] = {
    "super_admin": [
        "user_manage", "role_manage", "grade_class_manage", "case_manage",
        "training_access", "score_review", "stats_view", "qa_access",
        "llm_monitor", "api_manage", "prompt_manage", "feedback_review",
        "export_data", "record_notes", "school_manage",
    ],
    "school_admin": [
        "user_manage", "role_manage", "grade_class_manage", "case_manage",
        "training_access", "score_review", "stats_view", "qa_access",
        "llm_monitor", "feedback_review", "export_data", "record_notes",
    ],
    "teacher": [
        "grade_class_manage", "case_manage", "training_access",
        "score_review", "stats_view", "feedback_review",
        "export_data", "record_notes",
    ],
    "student": [
        "training_access", "qa_access",
    ],
}

SYSTEM_ROLES: list[tuple[str, str]] = [
    ("super_admin", "超级管理员"),
    ("school_admin", "学校管理员"),
    ("teacher", "教师"),
    ("student", "学生"),
]
