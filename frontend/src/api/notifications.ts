import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

const NOTIFICATIONS = "/training/notifications" satisfies ApiPath;
const READ_ALL = "/training/notifications/read-all" satisfies ApiPath;
const NOTIF_READ = "/training/notifications/{notif_id}/read" satisfies ApiPath;
const NOTIF_UNREAD = "/training/notifications/{notif_id}/unread" satisfies ApiPath;

export const getNotifications = (params?: Record<string, unknown>) =>
	api.get<Schemas["TrainingNotificationItem"][]>(
		NOTIFICATIONS as string,
		{ params },
	);

export const markNotificationRead = (id: number) =>
	api.put<Schemas["OkResponse"]>(
		NOTIF_READ.replace("{notif_id}", String(id)),
	);

export const markNotificationUnread = (id: number) =>
	api.put<Schemas["OkResponse"]>(
		NOTIF_UNREAD.replace("{notif_id}", String(id)),
	);

export const markAllNotificationsRead = () =>
	api.put<Schemas["OkResponse"]>(READ_ALL as string);
