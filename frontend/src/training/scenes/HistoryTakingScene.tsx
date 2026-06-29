import { lazy, Suspense } from "react";
import LoadingState from "@/components/ui/loading-state";

const TrainingEngine = lazy(() =>
	import("@/engine").then((m) => ({ default: m.TrainingEngine })),
);

export default function HistoryTakingScene({
	recordId,
}: {
	recordId: string;
}) {
	return (
		<Suspense fallback={<LoadingState className="h-screen" />}>
			<TrainingEngine recordId={recordId} />
		</Suspense>
	);
}
