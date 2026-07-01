import { Suspense } from "react";
import { useTrainingContext } from "@/engine/TrainingContext";
import type { SceneCardProps } from "@/engine/scene-card";
import { getSceneCards } from "./scene-cards/registry";

/**
 * Renders the active scene cards for the current training type.
 * Cards are gated by feature flags and sorted by priority.
 */
export function SceneRenderer() {
  const { bus, features, recordId, trainingType } = useTrainingContext();
  const cards = getSceneCards(trainingType, features);

  if (cards.length === 0) return null;

  const cardProps: SceneCardProps = { bus, mode: "training", recordId };

  return (
    <div className="flex flex-col gap-3 w-72 border-l border-border bg-card overflow-y-auto shrink-0">
      {cards.map((card) => {
        const Component = card.component;
        return (
          <div key={card.id} className="border-b border-border last:border-b-0">
            <Suspense fallback={<div className="h-20" />}>
              <Component {...cardProps} />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
