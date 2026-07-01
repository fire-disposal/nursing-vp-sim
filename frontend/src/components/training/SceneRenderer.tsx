import { Suspense, useCallback, useRef, useState } from "react";
import { useTrainingContext } from "@/engine/TrainingContext";
import { ALL_CAPABILITIES } from "@/engine/capabilities";
import type { SceneCardProps } from "@/engine/scene-card";
import { getSceneCards } from "./scene-cards/registry";

const ICONS: Record<string, string> = {
  "patient-info": "👤",
  "inquiry":      "📋",
  "monitor":      "💓",
  "body-exam":    "🩺",
  "notes":        "📝",
  "mews":         "📊",
};

/**
 * Icon sidebar + draggable overlay panel.
 * Click an icon to open/close its card panel; drag the header to reposition.
 */
export function SceneRenderer() {
  const { bus, features, recordId, trainingType } = useTrainingContext();
  const cards = getSceneCards(trainingType, features);
  const [activeId, setActiveId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ x: 0, y: 0, dragging: false });

  const cardProps: SceneCardProps = { bus, mode: "training", recordId };

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
    const onUp = () => { dragRef.current.dragging = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  if (cards.length === 0) return null;

  const activeCard = cards.find((c) => c.id === activeId);

  return (
    <div className="relative shrink-0">
      {/* Icon bar */}
      <div className="flex flex-col items-center gap-1 border-l border-border bg-card py-2 px-1 h-full">
        {cards.map((card) => {
          const isActive = card.id === activeId;
          const cap = card.featureFlag ? ALL_CAPABILITIES[card.featureFlag] : null;
          return (
            <button key={card.id} onClick={() => setActiveId(isActive ? null : card.id)}
              className="flex items-center justify-center size-9 rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={cap?.label ?? card.id}
              style={isActive ? { borderColor: "var(--color-primary)", background: "var(--color-primary-10)" } : {}}
            >
              <span className="text-sm">{ICONS[card.id] ?? "◻"}</span>
            </button>
          );
        })}
      </div>

      {/* Overlay panel */}
      {activeCard && (
        <>
          <div ref={panelRef} style={{ width: bodyExamOnly(activeCard.id) ? 360 : 280 }}
            className="absolute top-0 right-full border border-border bg-card rounded-xl shadow-xl overflow-hidden"
          >
            {/* Draggable header */}
            <div onMouseDown={onHeaderDown} style={{ cursor: "grab" }}
              className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 select-none"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {ALL_CAPABILITIES[activeCard.featureFlag ?? ""]?.label ?? activeCard.id}
              </span>
              <button onClick={() => setActiveId(null)} className="text-muted-foreground hover:text-foreground text-xs leading-none">✕</button>
            </div>
            <Suspense fallback={<div className="h-20" />}>
              <activeCard.component {...cardProps} />
            </Suspense>
          </div>
          <div className="fixed inset-0 z-[-1]" onClick={() => setActiveId(null)} />
        </>
      )}
    </div>
  );
}

function bodyExamOnly(id: string) {
  return id === "body-exam" ? 480 : 280;
}
