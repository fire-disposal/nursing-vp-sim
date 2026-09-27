import { api } from "./client";
import type {
	ActionResultResponse,
	SessionCreateResponse,
	SimulationActionIn,
	SimulationActionRequest,
	SimulationSnapshot,
} from "./simulations-types.frozen";

// 路径不再出现在生成的 ApiPath 里（运行期暴露已关闭，见 docs/18 §八），因此这里不再用
// `satisfies ApiPath` 校验；字符串仍与后端模块 router 的 prefix 保持一致。
export const createSimulationSession = (caseId?: string) =>
	api
		.post<SessionCreateResponse>(
			"/simulations/sessions",
			caseId ? { case_id: caseId } : undefined,
		)
		.then((r) => r.data);

export const getSimulationSession = (sessionId: number) =>
	api
		.get<SimulationSnapshot>(`/simulations/sessions/${sessionId}`)
		.then((r) => r.data);

export const postSimulationAction = (
	sessionId: number,
	action: SimulationActionIn,
	opts: { expectedRevision?: number; idemKey?: string } = {},
) =>
	api
		.post<ActionResultResponse>(
			`/simulations/sessions/${sessionId}/actions`,
			{
				action,
				expected_revision: opts.expectedRevision,
				idem_key: opts.idemKey,
			} satisfies SimulationActionRequest,
		)
		.then((r) => r.data);
