import { z } from "zod";

export const roleCreateSchema = z.object({
	name: z.string().min(1, "请填写角色标识"),
	displayName: z.string().min(1, "请填写显示名称"),
});

export type RoleCreateValues = z.infer<typeof roleCreateSchema>;
