import { useEffect } from "react";
import type { MessageBus } from "@/engine/types";
import type { TrainingWSMessage } from "./useTrainingWS";
import { useTrainingWS } from "./useTrainingWS";

interface PendingWaiter {
  remaining: Set<string>;
  failure: string | null;
  timer: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface PendingState {
  active: Set<string>;
  waiters: Set<PendingWaiter>;
}

const pendingByBus = new WeakMap<MessageBus, PendingState>();

function getPendingState(bus: MessageBus): PendingState {
  let state = pendingByBus.get(bus);
  if (!state) {
    state = { active: new Set(), waiters: new Set() };
    pendingByBus.set(bus, state);
  }
  return state;
}

function settleRequest(bus: MessageBus, requestId: string, ok: boolean, error?: string) {
  const state = getPendingState(bus);
  state.active.delete(requestId);
  for (const waiter of [...state.waiters]) {
    if (!waiter.remaining.delete(requestId)) continue;
    if (!ok && !waiter.failure) waiter.failure = error || "训练内容保存失败";
    if (waiter.remaining.size > 0) continue;

    window.clearTimeout(waiter.timer);
    state.waiters.delete(waiter);
    if (waiter.failure) waiter.reject(new Error(waiter.failure));
    else waiter.resolve();
  }
}

export function waitForPendingToolRequests(bus: MessageBus, timeoutMs = 10_000): Promise<void> {
  const state = getPendingState(bus);
  const remaining = new Set(state.active);
  if (remaining.size === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const waiter: PendingWaiter = {
      remaining,
      failure: null,
      resolve,
      reject,
      timer: window.setTimeout(() => {
        state.waiters.delete(waiter);
        reject(new Error("训练内容保存超时"));
      }, timeoutMs),
    };
    state.waiters.add(waiter);
  });
}

export function useToolBridge(bus: MessageBus) {
  const { sendTool } = useTrainingWS();

  useEffect(() => {
    const onToolInvoke = (payload: {
      tool: string;
      action: string;
      params?: Record<string, unknown>;
      recordId: number;
    }) => {
      const requestId = sendTool(payload.recordId, payload.tool, payload.action, payload.params);
      getPendingState(bus).active.add(requestId);
    };
    return bus.on("tool:invoke", onToolInvoke);
  }, [bus, sendTool]);

  useTrainingWS((msg: TrainingWSMessage) => {
    if (msg.type !== "tool:error" && msg.type !== "tool:result") return;

    const requestId = typeof msg.request_id === "string" ? msg.request_id : "";
    const tool = typeof msg.tool === "string" ? msg.tool : "unknown";
    const action = typeof msg.action === "string" ? msg.action : "unknown";
    const ok = msg.type === "tool:result" && msg.ok === true;
    const error = typeof msg.error === "string"
      ? msg.error
      : typeof msg.detail === "string"
        ? msg.detail
        : ok
          ? undefined
          : "操作失败";

    if (requestId) settleRequest(bus, requestId, ok, error);

    bus.emit("tool:result", {
      requestId,
      tool,
      action,
      ok,
      data: msg.data && typeof msg.data === "object"
        ? msg.data as Record<string, unknown>
        : {},
      error,
    });

    if (msg.scene && typeof msg.scene === "object") {
      bus.emit("scene:state", msg.scene as Record<string, unknown>);
    }
  });
}
