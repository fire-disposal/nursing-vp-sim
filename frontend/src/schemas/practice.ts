import { z } from "zod";

export const practiceSchema = z.object({
	name: z.string().min(1, "请填写名称"),
	description: z.string(),
	case_id: z.number().min(1, "请选择病例"),
	features: z.record(z.string(), z.boolean()),
	time_limit: z.number().min(5).max(120),
	is_active: z.boolean(),
});

export type PracticeValues = z.infer<typeof practiceSchema>;
