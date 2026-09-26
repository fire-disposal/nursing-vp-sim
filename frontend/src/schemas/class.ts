import { z } from "zod";

/** 班级表单：名称必填，cohort_label（届/年级标签）可选但用于消歧。 */
export const classFormSchema = z.object({
	name: z.string().min(1, "名称不能为空"),
	cohortLabel: z.string(),
});

export type ClassFormValues = z.infer<typeof classFormSchema>;
