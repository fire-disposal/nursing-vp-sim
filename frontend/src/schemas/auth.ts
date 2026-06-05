import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名").max(50, "用户名不能超过50个字符"),
  password: z.string().min(1, "请输入密码"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, "请输入原密码"),
    newPassword: z.string().min(6, "新密码至少6个字符").max(128, "新密码不能超过128个字符"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "两次新密码不一致",
    path: ["confirmPassword"],
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
