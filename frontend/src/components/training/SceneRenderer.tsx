import { Suspense, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { useTrainingContext } from "@/engine/TrainingContext";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { useToolBridge } from "@/hooks/useToolBridge";
import { getTools, TOOL_META } from "./tools/registry";

const WIDE_PANEL_CAPS = new Set(["physical_exam", "nursing_record"]);
const PANEL_WIDTH_WIDE = 400;
const PANEL_WIDTH_DEFAULT = 300;

/**
 * 桌面端工具区：右侧图标栏 + 停靠侧栏面板。
 * 面板是布局的一部分（flex 兄弟节点），打开时将聊天区向左挤压，
 * 不遮挡对话、无拖拽状态；点击激活图标或 ✕ 收起。移动端见 SceneToolbar。
 */
export function SceneRenderer() {
  const { bus, capabilities, recordId, trainingType, recordDetail } = useTrainingContext();
  const tools = getTools(trainingType, capabilities);
  const [activeId, setActiveId] = useState<string | null>(null);

  const toolProps: TrainingToolProps = { bus, recordId, recordDetail };

  useToolBridge(bus);

  if (tools.length === 0) return null;

  const activeTool = tools.find((c) => c.id === activeId);

  return (
    <div className="shrink-0 hidden md:flex h-full">
      {/* Docked panel — part of layout, pushes chat left */}
      {activeTool && (
        <div
          style={{ width: panelWidth(activeTool) }}
          className="h-full flex flex-col border-l border-border bg-card overflow-hidden animate-in slide-in-from-right-2 duration-200"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
            <span className="text-xs font-medium text-muted-foreground truncate">
              {TOOL_META[activeTool.id]?.icon ?? "◻"} {TOOL_META[activeTool.id]?.title ?? activeTool.id}
            </span>
            <button
              onClick={() => setActiveId(null)}
              className="text-muted-foreground hover:text-foreground text-xs leading-none px-1"
              title="收起面板"
              aria-label="收起面板"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <Suspense fallback={<div className="h-20" />}>
              <SceneStateProvider bus={bus}>
                <ErrorBoundary
                  fallback={
                    <div className="flex flex-col items-center gap-2 p-4 text-sm text-muted-foreground">
                      <span>卡片加载失败</span>
                      <span className="text-xs">
                        {ALL_CAPABILITIES[activeTool.capability ?? ""]?.label ?? activeTool.id}
                      </span>
                    </div>
                  }
                >
                  <activeTool.component {...toolProps} />
                </ErrorBoundary>
              </SceneStateProvider>
            </Suspense>
          </div>
        </div>
      )}

      {/* Icon rail */}
      <div className="flex flex-col items-center gap-1 border-l border-border bg-card py-2 px-1 h-full overflow-y-auto">
        {tools.map((tool) => {
          const isActive = tool.id === activeId;
          const cap = tool.capability ? ALL_CAPABILITIES[tool.capability] : null;
          return (
            <button key={tool.id} onClick={() => setActiveId(isActive ? null : tool.id)}
              className="flex items-center justify-center size-9 rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={cap?.label ?? tool.id}
              style={isActive ? { borderColor: "var(--color-primary)", background: "var(--color-primary-10)" } : {}}
            >
              <span className="text-sm">{TOOL_META[tool.id]?.icon ?? "◻"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function panelWidth(tool: { capability?: string }) {
  return tool.capability && WIDE_PANEL_CAPS.has(tool.capability) ? PANEL_WIDTH_WIDE : PANEL_WIDTH_DEFAULT;
}
