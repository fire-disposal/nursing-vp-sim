import { Suspense, useState } from "react";
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
 * Compact icon sidebar + overlay panel.
 * Click an icon to open/close its card panel.
 */
export function SceneRenderer() {
  const { bus, features, recordId, trainingType } = useTrainingContext();
  const cards = getSceneCards(trainingType, features);
  const [activeId, setActiveId] = useState<string | null>(null);

  const cardProps: SceneCardProps = { bus, mode: "training", recordId };

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
            <button
              key={card.id}
              onClick={() => setActiveId(isActive ? null : card.id)}
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
          <div className="absolute top-0 right-full w-72 border border-border bg-card rounded-l-xl shadow-xl overflow-y-auto" style={{ maxHeight: "calc(100vh - 4rem)" }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground">
                {ALL_CAPABILITIES[activeCard.featureFlag ?? ""]?.label ?? activeCard.id}
              </span>
              <button onClick={() => setActiveId(null)} className="text-muted-foreground hover:text-foreground text-xs">
                ✕
              </button>
            </div>
            <Suspense fallback={<div className="h-20" />}>
              <activeCard.component {...cardProps} />
            </Suspense>
          </div>
          {/* Backdrop */}
          <div className="fixed inset-0 z-[-1]" onClick={() => setActiveId(null)} />
        </>
      )}
    </div>
  );
}
