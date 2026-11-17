import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import { useSchoolScopeStore } from "@/stores/schoolScopeStore";

/**
 * 会话访问上下文 —— axios、SSE、电话 TTS/聊天、WebSocket 的唯一来源。
 *
 * 只要一个通道自己拼鉴权头，就会出现「UI 已切学生、某个请求仍按 ops 鉴权」的分叉。
 * 所有网络通道必须从这里取值；无 token 时不发 Authorization。
 */
export interface AccessContext {
	token: string | null;
	persona: string | null;
	schoolId: number | null;
}

export function currentAccessContext(): AccessContext {
	const token = useAuthStore.getState().token;
	const persona = usePersonaStore.getState().active;
	const school = useSchoolScopeStore.getState().school;
	return {
		token,
		// persona 只在登录后发送；院校是工作视图偏好，沿用既有 axios 语义独立携带。
		persona: token ? persona : null,
		schoolId: school?.id ?? null,
	};
}

/** HTTP 头：Bearer + 当前视角 + 当前院校。 */
export function accessHeaders(): Record<string, string> {
	const { token, persona, schoolId } = currentAccessContext();
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (persona) headers["X-View-Persona"] = persona;
	if (schoolId != null) headers["X-School-Scope"] = String(schoolId);
	return headers;
}

/** WebSocket 查询参数：浏览器不能带自定义头，语义与 HTTP 头一致。 */
export function wsAccessParams(): Record<string, string> {
	const { token, persona, schoolId } = currentAccessContext();
	const params: Record<string, string> = {};
	if (token) params.token = token;
	if (persona) params.persona = persona;
	if (schoolId != null) params.school = String(schoolId);
	return params;
}
