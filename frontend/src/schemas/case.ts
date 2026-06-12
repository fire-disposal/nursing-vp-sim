import { z } from "zod";

export const caseFormSchema = z.object({
	name: z
		.string()
		.min(1, "请输入病例名称")
		.max(100, "病例名称不能超过100个字符"),
	time_limit: z.number().min(5, "至少5分钟").max(120, "最多120分钟"),
	difficulty: z.number().min(1).max(3),
	description: z.string().optional(),
	chief_complaint: z.string().optional(),
	opening_line: z.string().optional(),
});

export type CaseFormValues = z.infer<typeof caseFormSchema>;
