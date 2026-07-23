import { useEffect, useRef } from "react";
import type { MessageBus } from "@/engine/types";
import type { TrainingWSMessage } from "./useTrainingWS";
import { useTrainingWS } from "./useTrainingWS";

const _registered = new WeakSet<MessageBus>();

export function useToolBridge(bus: MessageBus) {
  const skipRef = useRef<boolean | null>(null);
  if (skipRef.current === null) {
    skipRef.current = _registered.has(bus);
    _registered.add(bus);
  }

  const { sendTool } = useTrainingWS();

  useEffect(() => {
    const onToolInvoke = (payload: {
      tool: string;
      action: string;
      params?: Record<string, unknown>;
      recordId: number;
    }) => {
      sendTool(payload.recordId, payload.tool, payload.action, payload.params);
    };
    bus.on("tool:invoke", onToolInvoke);
    return () => { bus.off("tool:invoke", onToolInvoke); };
  }, [bus, sendTool]);

  useTrainingWS((msg: TrainingWSMessage) => {
    if (skipRef.current) return;
    if (msg.type !== "tool:result") return;

    const m = msg as {
      type: "tool:result";
      tool: string;
      action: string;
      ok: boolean;
      data?: Record<string, unknown>;
      scene?: Record<string, unknown>;
      error?: string;
    };

    bus.emit("tool:result", {
      tool: m.tool,
      action: m.action,
      ok: m.ok,
      data: m.data ?? {},
      error: m.error,
    });

    if (m.scene) {
      bus.emit("scene:state", m.scene);
    }
  });
}
