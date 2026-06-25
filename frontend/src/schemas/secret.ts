import { z } from "zod";

export const secretFormSchema = z.object({
	label: z.string().min(1, "请输入标签"),
	baseUrl: z.string().optional(),
	rawKey: z.string().optional(),
	priceInput: z.number().min(0, "不能为负"),
	priceOutput: z.number().min(0, "不能为负"),
	monthlyLimit: z.number().min(0).nullable(),
});

export type SecretFormValues = z.infer<typeof secretFormSchema>;
