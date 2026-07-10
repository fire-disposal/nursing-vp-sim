"""权限词表 —— 系统权限的单一真相。

- `roles.py` 的角色→权限映射只能引用此处定义的 key（import 时校验）。
- 前端 `frontend/src/config/permissions.gen.ts` 由 `scripts/gen_permissions_ts.py`
  从本文件派生（`pnpm run perm:generate`，已并入 `api:update`），杜绝前后端漂移。

新增权限：在 `PERMISSIONS` 追加一项，重新生成前端词表即可。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PermissionDef:
    key: str
    label: str


PERMISSIONS: list[PermissionDef] = [
    PermissionDef("user_manage", "用户管理"),
    PermissionDef("role_manage", "角色管理"),
    PermissionDef("grade_class_manage", "班级管理"),
    PermissionDef("case_manage", "病例管理"),
    PermissionDef("training_access", "训练功能"),
    PermissionDef("score_review", "成绩查看"),
    PermissionDef("stats_view", "数据统计"),
    PermissionDef("qa_access", "护理问答"),
    PermissionDef("llm_monitor", "LLM 监控"),
    PermissionDef("api_manage", "API 管理"),
    PermissionDef("assignment_manage", "练习发布"),
    PermissionDef("feedback_review", "反馈管理"),
    PermissionDef("export_data", "数据导出"),
    PermissionDef("record_notes", "训练批注"),
    PermissionDef("questionnaire_manage", "问卷管理"),
]

PERMISSION_KEYS: tuple[str, ...] = tuple(p.key for p in PERMISSIONS)
PERMISSION_LABELS: dict[str, str] = {p.key: p.label for p in PERMISSIONS}
