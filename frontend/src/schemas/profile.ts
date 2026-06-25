import { z } from "zod";

export const profileSchema = z.object({
	displayName: z.string().min(1, "请输入显示名称"),
	studentId: z.string().optional(),
	gender: z.string(),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

export const passwordChangeSchema = z.object({
	oldPassword: z.string().min(1, "请输入原密码"),
	newPassword: z.string().min(6, "新密码至少 6 个字符"),
});

export type PasswordChangeFormValues = z.infer<typeof passwordChangeSchema>;
