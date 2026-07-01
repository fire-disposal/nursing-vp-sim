import { Suspense } from "react";
import { useTrainingContext } from "@/engine/TrainingContext";
import { ALL_CAPABILITIES } from "@/engine/capabilities";
import type { SceneCardProps } from "@/engine/scene-card";
import { getSceneCards } from "./scene-cards/registry";

/**
 * Renders the active scene cards for the current training type.
 * Each card is gated by its featureFlag and displayed with a
 * capability-based header when relevant.
 */
export function SceneRenderer() {
  const { bus, features, recordId, trainingType } = useTrainingContext();
  const cards = getSceneCards(trainingType, features);

  if (cards.length === 0) return null;

  const cardProps: SceneCardProps = { bus, mode: "training", recordId };

  return (
    <div className="flex flex-col w-72 border-l border-border bg-card overflow-y-auto shrink-0">
      {cards.map((card) => {
        const Component = card.component;
        const cap = card.featureFlag ? ALL_CAPABILITIES[card.featureFlag] : null;
        return (
          <section key={card.id} className="border-b border-border last:border-b-0">
            {cap && (
              <div className="px-3 pt-2 pb-0.5">
                <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  {cap.label}
                </span>
              </div>
            )}
            <Suspense fallback={<div className="h-16" />}>
              <Component {...cardProps} />
            </Suspense>
          </section>
        );
      })}
    </div>
  );
}
