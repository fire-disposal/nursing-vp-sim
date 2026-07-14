import type { MessageBus } from "@/engine/types";
import { useTrainingWS } from "./useTrainingWS";

export function useExamBridge(bus: MessageBus) {
  useTrainingWS((msg) => {
    const m = msg as unknown as {
      type: string;
      op_type?: string;
      data?: { value: string; label?: string; unit?: string };
      scene?: Partial<import("@/engine/scene-state").SceneState>;
    };
    if (m.type !== "exam:done") return;
    if (m.scene) bus.emit("scene:state", m.scene);
    if (m.op_type && m.data?.value) {
      bus.emit("scene:exam", {
        op_type: m.op_type,
        value: m.data.value,
        label: m.data.label,
        unit: m.data.unit,
      });
    }
  });
}
