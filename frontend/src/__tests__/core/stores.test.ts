import { describe, expect, it } from "vitest";

describe("gradesClassesStore", () => {
	it("initializes with empty grades and classes", async () => {
		const { default: useGradesClassesStore } = await import(
			"@/stores/gradesClassesStore"
		);
		const state = useGradesClassesStore.getState();
		expect(state.grades).toEqual([]);
		expect(state.classes).toEqual([]);
		expect(state.loading).toBe(false);
	});
});
