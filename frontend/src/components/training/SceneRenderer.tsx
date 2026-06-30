import { useEffect } from "react";

/**
 * Bridge component that receives the real MessageBus from TrainingContext
 * and relays events to the active scene.
 *
 * In sandbox:  scene receives `{ bus: MockMessageBus, mode: "sandbox" }`
 * In production: scene receives `{ bus: real MessageBus,  mode: "training" }`
 *
 * The component is a no-op until a scene is registered — see the
 * integration doc at docs/scene-system/integration-analysis.md
 */
export function SceneRenderer() {
	// TODO: Once capa `scene_3d` lands, load the matching scene + pass bus
	return null;
}
