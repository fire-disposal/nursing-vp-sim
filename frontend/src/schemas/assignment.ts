import { z } from "zod";

export const assignmentSchema = z
	.object({
		title: z.string().min(1, "请填写标题"),
		desc: z.string(),
		caseId: z.number().min(1, "请选择病例"),
		classId: z.number().min(1, "请选择班级"),
		startTime: z.string().min(1, "请选择开始时间"),
		endTime: z.string().min(1, "请选择截止时间"),
		maxAttempts: z.number().int("必须为整数").min(0, "不能为负数"),
		mode: z.enum(["guided", "assessment"]),
		hideCaseInfo: z.boolean(),
		/** 受众模式：全班（发布时快照全班学生）或指定学生。 */
		audienceMode: z.enum(["class", "selected"]),
		/** 指定学生受众的 user_id 列表（audienceMode='selected' 时必填）。 */
		recipientIds: z.array(z.number()),
	})
	.refine(
		(data) => !data.endTime || !data.startTime || data.endTime > data.startTime,
		{ message: "截止时间必须晚于开始时间", path: ["endTime"] },
	)
	.refine(
		(data) => data.audienceMode !== "selected" || data.recipientIds.length > 0,
		{ message: "请至少选择 1 名学生", path: ["recipientIds"] },
	);

export type AssignmentValues = z.infer<typeof assignmentSchema>;
