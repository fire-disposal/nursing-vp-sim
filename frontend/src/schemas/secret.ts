import { z } from "zod";

export const secretFormSchema = z.object({
	label: z.string().min(1, "请输入标签"),
	baseUrl: z
		.string()
		.optional()
		.refine((v) => !v || /^https?:\/\/.+/.test(v), {
			message: "请输入完整 URL（含 https://）",
		}),
	rawKey: z.string().optional(),
	priceInput: z.number().min(0, "不能为负"),
	priceOutput: z.number().min(0, "不能为负"),
	monthlyLimit: z.number().min(0).nullable(),
	priority: z.number().int().min(0),
	modelOverride: z.string().nullable(),
});

export type SecretFormValues = z.infer<typeof secretFormSchema>;
