import { z } from "zod";

/** 病例生命周期（docs/15 §六）：draft 工作副本 → published 可训练 → archived 冻结。 */
export const caseStatusSchema = z.enum(["draft", "published", "archived"]);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

/** 发布门禁的字段级问题项（与后端 CaseValidationIssue 同形）。 */
const caseValidationIssueSchema = z.object({
	severity: z.string(),
	field: z.string(),
	message: z.string(),
	fix_hint: z.string(),
});

/** 发布门禁报告（与后端 CaseValidationReport 同形）。 */
export const caseValidationReportSchema = z.object({
	case_id: z.number(),
	case_name: z.string(),
	publishable: z.boolean(),
	errors: z.array(caseValidationIssueSchema),
	warnings: z.array(caseValidationIssueSchema),
	infos: z.array(caseValidationIssueSchema),
});
export type CaseValidationReportValues = z.infer<typeof caseValidationReportSchema>;

/**
 * 发布/编辑被门禁拒绝（422）时的响应外壳：``detail`` = ``{code, report}``。
 * 用于从 axios 异常里安全取出报告 —— 非门禁失败（网络/409/普通 422）解析失败即 null。
 */
export const casePublishGateErrorSchema = z.object({
	response: z.object({
		data: z.object({
			detail: z.object({
				code: z.literal("CASE_NOT_PUBLISHABLE"),
				message: z.string().optional(),
				report: caseValidationReportSchema,
			}),
		}),
	}),
});
