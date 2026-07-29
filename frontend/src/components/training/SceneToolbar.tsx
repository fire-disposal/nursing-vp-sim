/**
 * SceneToolbar — 移动端场景工具按钮栏
 *
 * 渲染在 ChatInput 上方，隐藏于大屏桌面端（lg:hidden）。
 * 点击图标打开对应的 Bottomsheet 面板。
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import Bottomsheet from "@/components/ui/bottomsheet";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { useTrainingStore } from "@/stores/trainingStore";
import type { TrainingTool, TrainingToolProps } from "@/engine/TrainingTool";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { cn } from "@/lib/utils";
import { getTools, TOOL_META } from "./tools/registry";

export default function SceneToolbar() {
  const bus = useTrainingStore(s => s.bus)!;
  const capabilities = useTrainingStore(s => s.capabilities);
  const trainingType = useTrainingStore(s => s.trainingType);
  const recordId = useTrainingStore(s => s.recordId);
  const recordDetail = useTrainingStore(s => s.recordDetail);
  const tools: TrainingTool[] = getTools(trainingType, capabilities);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeTool = tools.find((c) => c.id === activeId);
  const toolProps: TrainingToolProps = { bus, recordId, recordDetail };

  const handleClose = useCallback(() => setActiveId(null), []);


  useEffect(() => {
    const handler = (payload: { id: string }) => {
      if (window.matchMedia("(min-width: 1024px)").matches) return;
      if (tools.some((t) => t.id === payload.id)) setActiveId(payload.id);
    };
    return bus.on("tool:open", handler);
  }, [bus, tools]);

  if (tools.length === 0) return null;

  return (
    <>
      {/* Horizontal icon toolbar — placed above chat input on mobile */}
      <div className="flex items-center gap-1 px-1.5 py-1 border-t border-border bg-card shrink-0 lg:hidden overflow-x-auto">
        {tools.map((tool) => {
          const isActive = tool.id === activeId;
          const cap = tool.capability ? ALL_CAPABILITIES[tool.capability] : null;
          const Icon = TOOL_META[tool.id]?.icon;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveId(isActive ? null : tool.id)}
              className={cn(
                "relative flex h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-card px-3 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0",
                isActive && "border-primary bg-primary/10 text-primary",
              )}
              title={cap?.label ?? TOOL_META[tool.id]?.title ?? tool.id}
              aria-label={TOOL_META[tool.id]?.title ?? tool.id}
            >
              {isActive && <span className="absolute left-1.5 right-1.5 bottom-0.5 h-0.5 rounded-full bg-primary" />}
              {Icon ? <Icon className="size-4" /> : null}
              <span className="sr-only">{TOOL_META[tool.id]?.title ?? tool.id}</span>
            </button>
          );
        })}
      </div>

      {/* Bottomsheet panel */}
      {activeTool && (
        <Bottomsheet open onClose={handleClose} title={TOOL_META[activeTool.id]?.title ?? activeTool.id}>
          <Suspense fallback={<div className="h-20" />}>
            <SceneStateProvider bus={bus}>
              <ErrorBoundary
                fallback={
                  <div className="flex flex-col items-center gap-2 p-4 text-sm text-muted-foreground">
                    <span>卡片加载失败</span>
                  </div>
                }
              >
                <activeTool.component {...toolProps} />
              </ErrorBoundary>
            </SceneStateProvider>
          </Suspense>
        </Bottomsheet>
      )}
    </>
  );
}
