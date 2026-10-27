import { afterEach, describe, expect, it } from "vitest";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import { api } from "@/api/client";
import { useSchoolScopeStore } from "@/stores/schoolScopeStore";

/**
 * 「当前院校」作用域必须随请求发出（`X-School-Scope`）。
 *
 * 服务端只对平台角色采纳该头（院校角色的院校是硬边界），所以前端只负责如实带上：
 * 未选院校时不带头；选了就带 id。
 */
function captureHeader() {
	const seen: Record<string, unknown>[] = [];
	const adapter = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
		seen.push(config.headers as Record<string, unknown>);
		return { data: {}, status: 200, statusText: "OK", headers: {}, config: config as never };
	};
	return { seen, adapter };
}

afterEach(() => {
	useSchoolScopeStore.getState().setSchool(null);
});

describe("院校作用域请求头", () => {
	it("未选院校（全部院校）不发送 X-School-Scope", async () => {
		const { seen, adapter } = captureHeader();
		await api.get("/probe", { adapter });
		expect(seen[0]["X-School-Scope"]).toBeUndefined();
	});

	it("选院校后每个请求都带上该院校 id", async () => {
		useSchoolScopeStore.getState().setSchool({
			id: 7,
			name: "杭州师范大学",
			themeColor: null,
			hasLogo: false,
			logoUpdatedAt: null,
		});
		const { seen, adapter } = captureHeader();
		await api.get("/probe", { adapter });
		expect(seen[0]["X-School-Scope"]).toBe("7");
	});
});
