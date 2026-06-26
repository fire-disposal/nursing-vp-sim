import type { ApiPath } from "../api-path";
import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

const BASE = "/admin/system-notifications" satisfies ApiPath;
const NOTIF = "/admin/system-notifications/{notif_id}" satisfies ApiPath;

export const getSystemNotifications = (params?: Record<string, unknown>) =>
	api.get<Schemas["SystemNotificationResponse"][]>(
		BASE as string,
		{ params },
	);

export const createSystemNotification = (
	data: Schemas["SystemNotificationCreateRequest"],
) =>
	api.post<Schemas["SystemNotificationResponse"]>(
		BASE as string,
		data,
	);

export const updateSystemNotification = (
	id: number,
	data: Schemas["SystemNotificationUpdateRequest"],
) =>
	api.put<Schemas["SystemNotificationResponse"]>(
		NOTIF.replace("{notif_id}", String(id)),
		data,
	);

export const deleteSystemNotification = (id: number) =>
	api.delete<Schemas["OkResponse"]>(
		NOTIF.replace("{notif_id}", String(id)),
	);
