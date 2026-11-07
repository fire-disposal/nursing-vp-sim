import type { paths } from "./api-types.gen";

/**
 * 列表查询参数的**契约对齐**入口。
 *
 * 后端每个列表端点的筛选键由 OpenAPI 生成物给出；前端不手写参数名，直接从这里取，
 * 于是"后端改了筛选、前端没跟着改"会变成类型错误，而不是线上静默失效的筛选控件。
 */
export type ListQuery<P extends keyof paths> = paths[P] extends {
	get: { parameters: { query?: infer Q } };
}
	? NonNullable<Q>
	: never;

export type UserListParams = ListQuery<"/api/admin/users">;

/**
 * 用户列表筛选参数。
 *
 * 后端筛选键已由 `role` 改为 `persona`（视角），但 `api-types.gen.ts` 尚未重生成，
 * 故在生成的参数形状上做一次键替换；重生成后可恢复成 `ListQuery<"/api/admin/users">`。
 */
export type UserListFilterParams = Omit<UserListParams, "role"> & { persona?: string | null };
export type CaseManageParams = ListQuery<"/api/cases/manage/list">;
export type FeedbackAdminParams = ListQuery<"/api/admin/feedback">;
export type QuestionnaireTemplateParams = ListQuery<"/api/questionnaires/templates">;
export type AuditLogParams = ListQuery<"/api/admin/audit-logs">;
