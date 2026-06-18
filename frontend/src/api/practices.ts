import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getPractices = () =>
	api.get<Schemas["PaginatedResponse_PracticeItem_"]>("/admin/practices" satisfies ApiPath as string);
