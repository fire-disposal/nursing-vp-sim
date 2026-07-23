import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { useTrainingContext } from "@/engine/TrainingContext";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { useToolBridge } from "@/hooks/useToolBridge";
import { getTools, TOOL_META } from "./tools/registry";

const WIDE_PANEL_CAPS = new Set(["physical_exam", "nursing_record"]);
const PANEL_WIDTH_WIDE = 400;
const PANEL_WIDTH_DEFAULT = 280;

/**
 * Icon sidebar + draggable overlay panel.
 * Click an icon to open/close its card panel; drag the header to reposition.
 * Click _ to minimize (collapses to header only), ✕ to fully close.
 */
export function SceneRenderer() {
  const { bus, capabilities, recordId, trainingType, recordDetail } = useTrainingContext();
  const tools = getTools(trainingType, capabilities);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ x: 0, y: 0, dragging: false });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const toggleMinimize = useCallback((id: string) => {
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toolProps: TrainingToolProps = { bus, recordId, recordDetail };

  useToolBridge(bus);

  // ── Drag logic ──
  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    const el = panelRef.current;
    if (!el) return;
    dragRef.current = { x: e.clientX - el.offsetLeft, y: e.clientY - el.offsetTop, dragging: true };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      el.style.left = `${ev.clientX - dragRef.current.x}px`;
      el.style.top = `${ev.clientY - dragRef.current.y}px`;
    };
    const onUp = () => { dragRef.current.dragging = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); dragCleanupRef.current = null; };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    dragCleanupRef.current = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    return () => dragCleanupRef.current?.();
  }, []);

  if (tools.length === 0) return null;

  const activeTool = tools.find((c) => c.id === activeId);

  return (
    <div className="relative shrink-0 hidden md:flex">
      {/* Icon bar */}
      <div className="flex flex-col items-center gap-1 border-l border-border bg-card py-2 px-1 h-full">
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

      {/* Overlay panel */}
      {activeTool && (
        <>
          <div ref={panelRef} style={{ width: panelWidth(activeTool) }}
            className="absolute top-0 right-full border border-border bg-card rounded-xl shadow-xl overflow-hidden"
          >
            {/* Draggable header */}
            <div onMouseDown={!minimized.has(activeTool.id) ? onHeaderDown : undefined} style={{ cursor: "grab" }}
              className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 select-none"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {TOOL_META[activeTool.id]?.icon ?? "◻"} {TOOL_META[activeTool.id]?.title ?? activeTool.id}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={(e) => { e.stopPropagation(); toggleMinimize(activeTool.id) }}
                  className="text-muted-foreground hover:text-foreground text-xs leading-none px-1">
                  {minimized.has(activeTool.id) ? "□" : "_"}
                </button>
                <button onClick={() => setActiveId(null)} className="text-muted-foreground hover:text-foreground text-xs leading-none">✕</button>
              </div>
            </div>
            {minimized.has(activeTool.id) ? (
              <div className="flex items-center gap-1 px-3 py-1 text-[10px] text-muted-foreground/50 select-none cursor-pointer"
                onClick={() => toggleMinimize(activeTool.id)}>
                <span className="text-[10px]">⋯</span>
                <span>minimized — click to expand</span>
              </div>
            ) : (
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
            )}
          </div>
          <div className="fixed inset-0 z-[-1]" onClick={() => setActiveId(null)} />
        </>
      )}
    </div>
  );
}

function panelWidth(tool: { capability?: string }) {
  return tool.capability && WIDE_PANEL_CAPS.has(tool.capability) ? PANEL_WIDTH_WIDE : PANEL_WIDTH_DEFAULT;
}
