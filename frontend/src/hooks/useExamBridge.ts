import { useEffect, useRef } from "react";
import type { MessageBus } from "@/engine/types";
import { useTrainingWS } from "./useTrainingWS";

const _registered = new WeakSet<MessageBus>();

export function useExamBridge(bus: MessageBus) {
  const skipRef = useRef<boolean | null>(null);
  if (skipRef.current === null) {
    skipRef.current = _registered.has(bus);
    _registered.add(bus);
  }

  const { sendExam } = useTrainingWS();

  useEffect(() => {
    const onExamRequest = (recordId: number, opType: string) => {
      sendExam(recordId, opType);
    };
    bus.on("exam:request", onExamRequest);
    return () => { bus.off("exam:request", onExamRequest); };
  }, [bus, sendExam]);

  useTrainingWS((msg) => {
    if (skipRef.current) return;
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
