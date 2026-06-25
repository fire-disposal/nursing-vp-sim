import { z } from "zod";

export const gradeClassSchema = z.object({
	name: z.string().min(1, "名称不能为空"),
	gradeId: z.string(),
});

export type GradeClassValues = z.infer<typeof gradeClassSchema>;
