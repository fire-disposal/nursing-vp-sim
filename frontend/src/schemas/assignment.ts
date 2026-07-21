import { z } from "zod";

export const assignmentSchema = z.object({
	title: z.string().min(1, "请填写标题"),
	desc: z.string(),
	caseId: z.number().min(1, "请选择病例"),
	classId: z.number().min(1, "请选择班级"),
	startTime: z.string().min(1, "请选择开始时间"),
	endTime: z.string().min(1, "请选择截止时间"),
	maxAttempts: z.number().int("必须为整数").min(0, "不能为负数").nullable().optional(),
});

export type AssignmentValues = z.infer<typeof assignmentSchema>;
