import { lazy, Suspense, useEffect } from "react";
import { MewsPanel } from "@/components/training/panels/triage/MewsPanel";
import type { TabDef } from "../components/TabStack";
import TabStack from "../components/TabStack";

const TrainingEngine = lazy(() =>
  import("@/engine").then((m) => ({ default: m.TrainingEngine })),
);

export default function TriageScene({ recordId }: { recordId: string }) {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const tabs: TabDef[] = [
    {
      id: "mews",
      icon: <span style={{ fontSize: 14, fontWeight: 700 }}>M</span>,
      label: "分诊",
      panel: <MewsPanel recordId={recordId} />,
    },
  ];

  return (
    <div className="flex h-screen" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex-1 min-w-0">
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-muted-foreground">加载中…</div>}>
          <TrainingEngine recordId={recordId} />
        </Suspense>
      </div>
      <TabStack tabs={tabs} side="right" />
    </div>
  );
}
