import { beforeEach, describe, expect, it } from "vitest";
import { useSceneStore } from "@/stores/sceneStore";

const DEFAULT_ENV = { type: "clinic", time_of_day: "day", equipment: [] };
const DEFAULT_PATIENT = {
	position: "supine",
	consciousness: "alert",
	expression: "neutral",
	visible_symptoms: [],
};

beforeEach(() => {
	useSceneStore.getState().resetScene();
	useSceneStore.getState().attachBus(null);
});

describe("sceneStore", () => {
	it("initializes with default scene", () => {
		const { scene, bus } = useSceneStore.getState();
		expect(bus).toBeNull();
		expect(scene.environment).toEqual(DEFAULT_ENV);
		expect(scene.patient).toEqual(DEFAULT_PATIENT);
		expect(scene.vitals).toEqual({});
	});

	it("attachBus stores bus and resets scene", () => {
		const bus = { on: () => () => {} } as never;
		useSceneStore.getState().patchScene({ vitals: { hr: 80 } });
		useSceneStore.getState().attachBus(bus);
		const state = useSceneStore.getState();
		expect(state.bus).toBe(bus);
		expect(state.scene.vitals).toEqual({});
	});

	it("attachBus same bus is a no-op", () => {
		const bus = { on: () => () => {} } as never;
		useSceneStore.getState().attachBus(bus);
		useSceneStore.getState().patchScene({ vitals: { hr: 80 } });
		useSceneStore.getState().attachBus(bus);
		expect(useSceneStore.getState().scene.vitals).toEqual({ hr: 80 });
	});

	it("patchScene shallow-merges environment fields", () => {
		useSceneStore.getState().patchScene({ environment: { type: "icu" } });
		const env = useSceneStore.getState().scene.environment;
		expect(env?.type).toBe("icu");
		expect(env?.time_of_day).toBe("day");
	});

	it("patchScene replaces non-object values", () => {
		useSceneStore.getState().patchScene({ patient: { expression: "pain" } });
		const patient = useSceneStore.getState().scene.patient;
		expect(patient?.expression).toBe("pain");
		expect(patient?.position).toBe("supine");
	});

	it("patchScene replaces arrays instead of merging", () => {
		useSceneStore.getState().patchScene({ environment: { equipment: ["stethoscope"] } });
		expect(useSceneStore.getState().scene.environment?.equipment).toEqual(["stethoscope"]);
	});

	it("patchScene null values are applied", () => {
		useSceneStore.getState().patchScene({ vitals: null as never });
		expect(useSceneStore.getState().scene.vitals).toBeNull();
	});

	it("resetScene restores defaults after mutations", () => {
		useSceneStore.getState().patchScene({ vitals: { hr: 100 }, environment: { type: "er" } });
		useSceneStore.getState().resetScene();
		const scene = useSceneStore.getState().scene;
		expect(scene.environment).toEqual(DEFAULT_ENV);
		expect(scene.vitals).toEqual({});
	});
});
