import { z } from "zod";

export const registerUserSchema = z.object({
  username: z.string().min(1, "用户名不能为空").regex(/^[a-zA-Z0-9_]+$/, "用户名只能包含字母、数字和下划线"),
  password: z.string().min(6, "密码至少6位"),
  role: z.string().min(1, "请选择角色"),
  display_name: z.string().min(1, "姓名不能为空"),
  student_id: z.string().optional(),
  class_id: z.string().optional(),
});

export const editUserSchema = z.object({
  display_name: z.string().min(1, "姓名不能为空"),
  student_id: z.string().optional(),
  role: z.string().min(1, "请选择角色"),
  password: z.string().optional(),
  class_id: z.string().optional(),
});

export type RegisterUserValues = z.infer<typeof registerUserSchema>;
export type EditUserValues = z.infer<typeof editUserSchema>;
