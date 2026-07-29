import { create } from "zustand";
import type { SceneState } from "@/engine/scene-state";
import type { MessageBus } from "@/engine/types";

const DEFAULT_SCENE: SceneState = {
	environment: { type: "clinic", time_of_day: "day", equipment: [] },
	patient: {
		position: "supine",
		consciousness: "alert",
		expression: "neutral",
		visible_symptoms: [],
	},
	vitals: {},
};

function cloneScene(scene: SceneState): SceneState {
	return JSON.parse(JSON.stringify(scene)) as SceneState;
}

function mergeScene(base: SceneState, patch: Partial<SceneState>): SceneState {
	const out = { ...base } as Record<string, unknown>;
	for (const [key, val] of Object.entries(patch)) {
		if (
			val !== null &&
			typeof val === "object" &&
			!Array.isArray(val) &&
			typeof out[key] === "object" &&
			out[key] !== null &&
			!Array.isArray(out[key])
		) {
			out[key] = { ...(out[key] as Record<string, unknown>), ...val };
		} else {
			out[key] = val;
		}
	}
	return out as SceneState;
}

interface SceneStore {
	bus: MessageBus | null;
	scene: SceneState;
	attachBus: (bus: MessageBus | null) => void;
	patchScene: (patch: Partial<SceneState>) => void;
	resetScene: () => void;
}

export const useSceneStore = create<SceneStore>()((set, get) => ({
	bus: null,
	scene: cloneScene(DEFAULT_SCENE),
	attachBus: (bus) => {
		if (get().bus === bus) return;
		set({ bus, scene: cloneScene(DEFAULT_SCENE) });
	},
	patchScene: (patch) => {
		set((state) => ({ scene: mergeScene(state.scene, patch) }));
	},
	resetScene: () => set({ scene: cloneScene(DEFAULT_SCENE) }),
}));
