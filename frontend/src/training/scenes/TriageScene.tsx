import { lazy, Suspense } from "react";
import { SceneRenderer } from "@/components/training/SceneRenderer";

const TrainingEngine = lazy(() =>
  import("@/engine").then((m) => ({ default: m.TrainingEngine })),
);

export default function TriageScene({ recordId }: { recordId: string }) {
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">加载中…</div>}>
        <TrainingEngine recordId={recordId}>
          <SceneRenderer />
        </TrainingEngine>
      </Suspense>
    </div>
  );
}
