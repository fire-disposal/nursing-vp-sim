import { z } from "zod";

export const notificationSchema = z.object({
	title: z.string().min(1, "标题不能为空"),
	content: z.string().min(1, "内容不能为空"),
	level: z.enum(["info", "warning", "success"]),
	published_at: z.string().optional(),
});

export type NotificationValues = z.infer<typeof notificationSchema>;
