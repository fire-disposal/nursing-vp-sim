import { afterEach, describe, expect, it } from "vitest";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import { useSchoolScopeStore } from "@/stores/schoolScopeStore";
import { accessHeaders, currentAccessContext, wsAccessParams } from "@/utils/accessContext";

/** 所有网络通道（axios/SSE/裸 fetch/WS）必须共用这一份会话上下文。 */
describe("accessContext", () => {
	afterEach(() => {
		useAuthStore.setState({ token: null });
		usePersonaStore.getState().clear();
		useSchoolScopeStore.getState().setSchool(null);
	});

	it("HTTP 头同时携带登录、视角与院校", () => {
		useAuthStore.setState({ token: "jwt-token" });
		usePersonaStore.setState({ available: ["student", "ops"], active: "student" });
		useSchoolScopeStore.getState().setSchool({
			id: 7,
			name: "示例院校",
			themeColor: null,
			hasLogo: false,
			logoUpdatedAt: null,
		});

		expect(accessHeaders()).toEqual({
			Authorization: "Bearer jwt-token",
			"X-View-Persona": "student",
			"X-School-Scope": "7",
		});
	});

	it("WebSocket 查询参数与 HTTP 头语义一致", () => {
		useAuthStore.setState({ token: "jwt-token" });
		usePersonaStore.setState({ available: ["teacher"], active: "teacher" });

		expect(wsAccessParams()).toEqual({ token: "jwt-token", persona: "teacher" });
	});

	it("未登录时不带 token/persona，院校偏好沿用既有语义", () => {
		useAuthStore.setState({ token: null });
		usePersonaStore.setState({ available: ["student"], active: "student" });
		useSchoolScopeStore.getState().setSchool({
			id: 3,
			name: "旧院校",
			themeColor: null,
			hasLogo: false,
			logoUpdatedAt: null,
		});

		expect(currentAccessContext()).toEqual({ token: null, persona: null, schoolId: 3 });
		expect(accessHeaders()).toEqual({ "X-School-Scope": "3" });
		expect(wsAccessParams()).toEqual({ school: "3" });
	});
});
