import { z } from "zod";

export const profileSchema = z.object({
	displayName: z.string().min(1, "请输入显示名称"),
	studentId: z.string().optional(),
	gender: z.string(),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

// 修改密码的表单规则只有 `schemas/auth.ts::changePasswordSchema`（含二次确认）一份。
