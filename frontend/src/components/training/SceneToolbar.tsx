/**
 * SceneToolbar — 移动端场景工具按钮栏
 *
 * 渲染在 ChatInput 上方，隐藏于桌面端（md:hidden）。
 * 点击图标打开对应的 Bottomsheet 面板。
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import Bottomsheet from "@/components/ui/bottomsheet";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { useTrainingStatic } from "@/engine/TrainingLayerContexts";
import type { TrainingTool, TrainingToolProps } from "@/engine/TrainingTool";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { useToolBridge } from "@/hooks/useToolBridge";
import { getTools, TOOL_META } from "./tools/registry";

export default function SceneToolbar() {
  const { bus, capabilities, trainingType, recordId, recordDetail } = useTrainingStatic();
  const tools: TrainingTool[] = getTools(trainingType, capabilities);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeTool = tools.find((c) => c.id === activeId);
  const toolProps: TrainingToolProps = { bus, recordId, recordDetail };

  const handleClose = useCallback(() => setActiveId(null), []);

  useToolBridge(bus);

  useEffect(() => {
    const handler = (payload: { id: string }) => {
      if (window.matchMedia("(min-width: 768px)").matches) return;
      if (tools.some((t) => t.id === payload.id)) setActiveId(payload.id);
    };
    return bus.on("tool:open", handler);
  }, [bus, tools]);

  if (tools.length === 0) return null;

  return (
    <>
      {/* Horizontal icon toolbar — placed above chat input on mobile */}
      <div className="flex items-center gap-1 px-1.5 py-1 border-t border-border bg-card shrink-0 md:hidden overflow-x-auto">
        {tools.map((tool) => {
          const isActive = tool.id === activeId;
          const cap = tool.capability ? ALL_CAPABILITIES[tool.capability] : null;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveId(isActive ? null : tool.id)}
              className="flex items-center gap-1 px-2.5 h-11 rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 text-sm"
              title={cap?.label ?? tool.id}
              style={isActive ? { borderColor: "var(--color-primary)", background: "var(--color-primary-10)" } : {}}
            >
              <span>{TOOL_META[tool.id]?.icon ?? "◻"}</span>
							<span>{TOOL_META[tool.id]?.title ?? tool.id}</span>
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
