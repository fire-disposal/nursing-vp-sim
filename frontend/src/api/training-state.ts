import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const triggerInitiative = (recordId: number) =>
	api.post<Schemas["InitiativeTriggerResponse"]>(
		`/training/${recordId}/initiative/trigger` as ApiPath,
	);
