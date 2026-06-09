import type { SlotProps } from "@/engine/types";
import { ScoreCard } from "./ScoreCard";
import { ScoringOverlay } from "./ScoringOverlay";

export function ScoringDisplaySlot(props: SlotProps) {
  return (
    <>
      <ScoringOverlay {...props} />
      <ScoreCard {...props} />
    </>
  );
}
