import { lazy } from "react";

export const TRAINING_SCENES: Record<
	string,
	React.ComponentType<{ recordId: string }>
> = {
	history_taking: lazy(() => import("./HistoryTakingScene")),
};

export type KnownTrainingType = keyof typeof TRAINING_SCENES;
