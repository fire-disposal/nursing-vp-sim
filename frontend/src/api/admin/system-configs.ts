import { api } from "@/api/axios-instance";

interface ConfigItem {
	key: string;
	value: string | null;
	description: string | null;
}

export function getSystemConfigs() {
	return api.get<ConfigItem[]>("/admin/config");
}

export function updateSystemConfig(key: string, value: string) {
	return api.put<ConfigItem>(`/admin/config/${key}`, { value });
}
