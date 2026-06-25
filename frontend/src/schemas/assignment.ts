import { z } from "zod";

export const assignmentSchema = z.object({
	title: z.string().min(1, "请填写标题"),
	desc: z.string(),
	practiceId: z.number().min(1, "请选择练习"),
	classId: z.number().min(1, "请选择班级"),
	startTime: z.string().min(1, "请选择开始时间"),
	endTime: z.string().min(1, "请选择截止时间"),
});

export type AssignmentValues = z.infer<typeof assignmentSchema>;
