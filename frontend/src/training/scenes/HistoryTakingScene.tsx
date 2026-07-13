import { lazy, Suspense } from "react";
import { SceneRenderer } from "@/components/training/SceneRenderer";
import LoadingState from "@/components/ui/loading-state";

const TrainingEngine = lazy(() =>
  import("@/engine").then((m) => ({ default: m.TrainingEngine })),
);

export default function HistoryTakingScene({ recordId }: { recordId: string }) {
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <Suspense fallback={<LoadingState className="h-full" />}>
        <TrainingEngine recordId={recordId}>
          <SceneRenderer />
        </TrainingEngine>
      </Suspense>
    </div>
  );
}
