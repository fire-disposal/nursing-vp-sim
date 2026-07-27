import ErrorBoundary from "@/components/ErrorBoundary";
import { SceneRenderer } from "@/components/training/SceneRenderer";
import { TrainingEngine } from "@/engine";

export default function TriageScene({ recordId }: { recordId: string }) {
  return (
		<div className="flex flex-col h-screen overflow-hidden" style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <ErrorBoundary
        fallback={
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
            <div className="text-sm font-medium">训练加载失败</div>
            <div className="text-xs">请返回重试或刷新页面</div>
          </div>
        }
      >
        <TrainingEngine recordId={recordId}>
          <SceneRenderer />
        </TrainingEngine>
      </ErrorBoundary>
    </div>
  );
}
