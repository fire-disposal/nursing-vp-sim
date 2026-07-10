// AUTO-GENERATED from backend/core/permissions.py — DO NOT EDIT.
// 由 `pnpm run perm:generate` 生成；修改权限请改后端并重新生成。

export const PERMISSION_KEYS = [
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
  "questionnaire_manage"
] as const;

export type Permission = (typeof PERMISSION_KEYS)[number];

export interface PermissionDef {
  key: Permission;
  label: string;
}

export const PERMISSION_DEFS: PermissionDef[] = [
  {
    "key": "user_manage",
    "label": "用户管理"
  },
  {
    "key": "role_manage",
    "label": "角色管理"
  },
  {
    "key": "grade_class_manage",
    "label": "班级管理"
  },
  {
    "key": "case_manage",
    "label": "病例管理"
  },
  {
    "key": "training_access",
    "label": "训练功能"
  },
  {
    "key": "score_review",
    "label": "成绩查看"
  },
  {
    "key": "stats_view",
    "label": "数据统计"
  },
  {
    "key": "qa_access",
    "label": "护理问答"
  },
  {
    "key": "llm_monitor",
    "label": "LLM 监控"
  },
  {
    "key": "api_manage",
    "label": "API 管理"
  },
  {
    "key": "assignment_manage",
    "label": "练习发布"
  },
  {
    "key": "feedback_review",
    "label": "反馈管理"
  },
  {
    "key": "export_data",
    "label": "数据导出"
  },
  {
    "key": "record_notes",
    "label": "训练批注"
  },
  {
    "key": "questionnaire_manage",
    "label": "问卷管理"
  }
];
