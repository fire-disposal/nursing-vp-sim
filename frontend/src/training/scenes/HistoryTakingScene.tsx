import { lazy, Suspense, useEffect } from "react";
import { SceneRenderer } from "@/components/training/SceneRenderer";
import LoadingState from "@/components/ui/loading-state";

const TrainingEngine = lazy(() =>
  import("@/engine").then((m) => ({ default: m.TrainingEngine })),
);

export default function HistoryTakingScene({ recordId }: { recordId: string }) {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return (
    <div style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", height: "100vh" }}>
      <Suspense fallback={<LoadingState className="h-screen" />}>
        <TrainingEngine recordId={recordId}>
          <SceneRenderer />
        </TrainingEngine>
      </Suspense>
    </div>
  );
}
