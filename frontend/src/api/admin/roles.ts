import { api } from "../axios-instance";

export const getRoles = () =>
	api.get<
		{
			id: number;
			name: string;
			display_name: string;
			is_system: boolean;
			permissions: string[];
			user_count: number;
		}[]
	>("/admin/roles");
