import { z } from "zod";

export const llmConfigSchema = z.object({
	secretId: z.string().min(1, "请选择密钥"),
	label: z.string(),
	purpose: z.string().min(1, "请选择用途"),
});

export type LlmConfigValues = z.infer<typeof llmConfigSchema>;
