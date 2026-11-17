import { afterEach, describe, expect, it } from "vitest";
import { ACTIVE_PERSONA_STORAGE_KEY, usePersonaStore } from "@/stores/personaStore";
import { isPersonaId, normalizePersona, PERSONA_ORDER } from "@/utils/personas";

/**
 * `platform` 视角并入 `ops` 后的客户端契约。
 *
 * 后端不再认识 `platform`，请求头带它会 403；因此旧版本留在 localStorage 里的选择
 * 必须在重新水合时归一，而不是等用户撞一次 403 才发现。
 */
const STORAGE_KEY = ACTIVE_PERSONA_STORAGE_KEY;

function persistRaw(value: unknown): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

describe("personaStore 持久化迁移", () => {
	afterEach(() => {
		localStorage.clear();
		usePersonaStore.getState().clear();
	});

	it("旧版本的 active='platform' 水合为 'ops'", async () => {
		persistRaw({ state: { active: "platform" }, version: 1 });

		await usePersonaStore.persist.rehydrate();

		expect(usePersonaStore.getState().active).toBe("ops");
	});

	it("旧版本的非 platform 选择原样保留", async () => {
		persistRaw({ state: { active: "teacher" }, version: 1 });

		await usePersonaStore.persist.rehydrate();

		expect(usePersonaStore.getState().active).toBe("teacher");
	});
});

describe("视角词表不再包含 platform", () => {
	it("PERSONA_ORDER 是四档，platform 不是有效视角", () => {
		expect([...PERSONA_ORDER]).toEqual(["student", "teacher", "admin", "ops"]);
		expect(isPersonaId("platform")).toBe(false);
		expect(isPersonaId("ops")).toBe(true);
	});

	it("normalizePersona 把 platform 归一到 ops，其余原样", () => {
		expect(normalizePersona("platform")).toBe("ops");
		expect(normalizePersona("ops")).toBe("ops");
		expect(normalizePersona("nurse_lead")).toBe("nurse_lead");
	});
});
