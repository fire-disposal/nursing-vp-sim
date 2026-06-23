import { describe, expect, it } from "vitest";
import { getActivePanels, PANELS } from "@/components/training/panels";

describe("PanelConfig", () => {
	it("has panels defined", () => {
		expect(PANELS.length).toBeGreaterThanOrEqual(5);
	});

	it("getActivePanels filters by feature flag", () => {
		const active = getActivePanels({});
		const emotionPanels = active.filter((p) => p.featureFlag === "emotion");
		expect(emotionPanels).toHaveLength(0);
	});

	it("emotion panel is no longer registered (handled by top bar)", () => {
		expect(PANELS.some((p) => p.id === "emotion")).toBe(false);
		const active = getActivePanels({ emotion: true });
		expect(active.filter((p) => p.featureFlag === "emotion")).toHaveLength(0);
	});

	it("returns sorted by priority", () => {
		const active = getActivePanels({
			emotion: true,
			patient_initiative: true,
			physical_exam: true,
		});
		for (let i = 1; i < active.length; i++) {
			expect(active[i].priority).toBeGreaterThanOrEqual(
				active[i - 1].priority,
			);
		}
	});
});
