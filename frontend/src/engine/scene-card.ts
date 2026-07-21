import type { ComponentType } from "react";
import type { MessageBus } from "./types";
import type { TrainingRecordDetail } from "./TrainingContext";

/** A scene card = a protocolised frontend component.
 *
 *  Like `SceneProps`, every card receives `{ bus, recordId, recordDetail }`.
 *  Cards communicate with the training engine exclusively through the MessageBus.
 *
 *  In sandbox:  card receives mock bus + mode="sandbox"
 *  In training: card receives real bus + mode="training"
 */
export interface SceneCard {
  id: string;
  component: ComponentType<SceneCardProps>;
  /** Gate this card behind a capability flag (e.g. "physical_exam"). */
  featureFlag?: string;
  /** Lower = higher in the layout. */
  priority: number;
}

export interface SceneCardProps {
  bus: MessageBus;
  recordId: string;
  recordDetail: TrainingRecordDetail | null;
}
