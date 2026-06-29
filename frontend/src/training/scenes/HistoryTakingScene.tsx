import { lazy, Suspense, useMemo } from "react";
import LoadingState from "@/components/ui/loading-state";
import { HISTORY_TAKING_PANELS } from "./history-taking/panels";

const TrainingEngine = lazy(() =>
	import("@/engine").then((m) => ({ default: m.TrainingEngine })),
);

export default function HistoryTakingScene({
	recordId,
}: {
	recordId: string;
}) {
	const panels = useMemo(() => HISTORY_TAKING_PANELS, []);
	return (
		<Suspense fallback={<LoadingState className="h-screen" />}>
			<TrainingEngine recordId={recordId} panels={panels} />
		</Suspense>
	);
}
