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

	it("getActivePanels includes emotion when enabled", () => {
		const active = getActivePanels({ emotion: true });
		const emotionPanels = active.filter((p) => p.featureFlag === "emotion");
		expect(emotionPanels).toHaveLength(1);
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
