import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const createSimulationSession = (caseId?: string) =>
	api
		.post<Schemas["SessionCreateResponse"]>(
			"/simulations/sessions" satisfies ApiPath as string,
			caseId ? { case_id: caseId } : undefined,
		)
		.then((r) => r.data);

export const getSimulationSession = (sessionId: number) =>
	api
		.get<Schemas["SimulationSnapshot"]>(`/simulations/sessions/${sessionId}` as ApiPath)
		.then((r) => r.data);

export const postSimulationAction = (
	sessionId: number,
	action: Schemas["SimulationActionIn"],
) =>
	api
		.post<Schemas["ActionResultResponse"]>(
			`/simulations/sessions/${sessionId}/actions` as ApiPath,
			{ action } satisfies Schemas["SimulationActionRequest"],
		)
		.then((r) => r.data);
