import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useTrainingStatic } from "@/engine/TrainingLayerContexts";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { SceneStateProvider } from "@/engine/useSceneBus";
import { useToolBridge } from "@/hooks/useToolBridge";
import { getTools, TOOL_META } from "./tools/registry";

const WIDE_PANEL_CAPS = new Set(["physical_exam", "nursing_record"]);
const PANEL_WIDTH_WIDE = 400;
const PANEL_WIDTH_DEFAULT = 300;

const ANIM_DURATION = 200; // ms — matches Tailwind duration-200

export function SceneRenderer() {
  const { bus, capabilities, recordId, trainingType, recordDetail } = useTrainingStatic();
  const tools = getTools(trainingType, capabilities);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const quizAutoOpenedRef = useRef(false);

  const toolProps: TrainingToolProps = { bus, recordId, recordDetail };

  useToolBridge(bus);

  useEffect(() => {
    const handler = (payload: { id: string }) => {
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      if (tools.some((t) => t.id === payload.id)) {
        if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
        setClosingId(null);
        setActiveId(payload.id);
      }
    };
    return bus.on("tool:open", handler);
  }, [bus, tools]);

  const handleClose = useCallback(() => {
    if (!activeId) return;
    setClosingId(activeId);
    closeTimerRef.current = setTimeout(() => {
      setActiveId(null);
      setClosingId(null);
      closeTimerRef.current = null;
    }, ANIM_DURATION);
  }, [activeId]);

	// Auto-open quiz tool on initial load when quiz capability is present
	useEffect(() => {
		if (quizAutoOpenedRef.current) return;
		if (capabilities.quiz && tools.some((t) => t.id === "quiz")) {
			quizAutoOpenedRef.current = true;
			setActiveId("quiz");
		}
	}, [capabilities.quiz, tools]);

	// Cleanup timer on unmount
	useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  if (tools.length === 0) return null;

  const showPanel = activeId || closingId;
  const isClosing = !!closingId;
  const displayTool = tools.find((c) => c.id === (closingId || activeId));

  return (
    <div className="shrink-0 hidden md:flex h-full">
      {/* Panel — always mounted during animation, width: 0 when closed */}
      <div
        style={{ width: showPanel && displayTool ? panelWidth(displayTool) : 0, transition: `width ${ANIM_DURATION}ms ease-out` }}
        className={cn(
          "h-full flex flex-col border-l border-border bg-card overflow-hidden pt-11 sm:pt-12",
          showPanel ? "opacity-100" : "opacity-0 border-l-0",
        )}
      >
        {showPanel && displayTool && (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
              <span className="text-xs font-medium text-muted-foreground truncate min-w-0">
                {TOOL_META[displayTool.id]?.icon ?? "◻"} {TOOL_META[displayTool.id]?.title ?? displayTool.id}
              </span>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground text-xs leading-none px-1 shrink-0" title="收起面板" aria-label="收起面板">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <Suspense fallback={<div className="h-20" />}>
                <SceneStateProvider bus={bus}>
                  <ErrorBoundary fallback={<div className="flex flex-col items-center gap-2 p-4 text-sm text-muted-foreground"><span>卡片加载失败</span></div>}>
                    <displayTool.component {...toolProps} />
                  </ErrorBoundary>
                </SceneStateProvider>
              </Suspense>
            </div>
          </>
        )}
      </div>

      {/* Icon rail */}
      <div className="flex flex-col items-center gap-1 border-l border-border bg-card py-2 px-1 h-full overflow-y-auto">
        {tools.map((tool) => {
          const isActive = tool.id === activeId;
          return (
            <button key={tool.id} onClick={() => isActive ? handleClose() : setActiveId(tool.id)}
              className="flex items-center justify-center size-9 rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={TOOL_META[tool.id]?.title ?? tool.id}
              style={isActive ? { borderColor: "var(--color-primary)", background: "var(--color-primary-10)" } : {}}
            ><span className="text-sm">{TOOL_META[tool.id]?.icon ?? "◻"}</span></button>
          );
        })}
      </div>
    </div>
  );
}

function panelWidth(tool: { capability?: string }) {
  return tool.capability && WIDE_PANEL_CAPS.has(tool.capability) ? PANEL_WIDTH_WIDE : PANEL_WIDTH_DEFAULT;
}

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
