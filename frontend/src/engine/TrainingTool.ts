import type { ComponentType } from "react";
import type { MessageBus } from "./types";
import type { TrainingRecordDetail } from "./TrainingContext";

/** A training tool = a protocolised frontend component.
 *
 *  Every tool receives `{ bus, recordId, recordDetail }`.
 *  Tools communicate with the training engine exclusively through the MessageBus.
 */
export interface TrainingTool {
  id: string;
  component: ComponentType<TrainingToolProps>;
  /** Gate this tool behind a capability key. undefined = always available. */
  capability?: string;
  /** Lower = higher in the layout. */
  priority: number;
}

export interface TrainingToolProps {
  bus: MessageBus;
  recordId: string;
  recordDetail: TrainingRecordDetail | null;
}
