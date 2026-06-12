import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getTrainingState = (recordId: number) =>
	api.get<Schemas["TrainingStateResponse"]>(`/training/${recordId}/state`);

export const triggerInitiative = (recordId: number) =>
	api.post<Schemas["InitiativeTriggerResponse"]>(
		`/training/${recordId}/initiative/trigger`,
	);

export const updateTrainingFeatures = (
	recordId: number,
	features: Record<string, boolean>,
) =>
	api.put<{ ok: boolean; features: Record<string, boolean> }>(
		`/training/${recordId}/features`,
		features,
	);
