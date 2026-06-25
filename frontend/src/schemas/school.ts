import { z } from "zod";

export const schoolCreateSchema = z.object({
	name: z.string().min(1, "请输入学校名称"),
	adminUsername: z.string().min(1, "请输入管理员用户名"),
	adminPassword: z.string().min(6, "至少6位"),
	adminDisplayName: z.string().min(1, "请输入管理员显示名"),
});

export type SchoolCreateValues = z.infer<typeof schoolCreateSchema>;
