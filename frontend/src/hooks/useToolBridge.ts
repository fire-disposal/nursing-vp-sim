import { useEffect } from "react";
import type { MessageBus } from "@/engine/types";
import type { TrainingWSMessage } from "./useTrainingWS";
import { subscribeWSConnection, useTrainingWS } from "./useTrainingWS";

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

/**
 * 断线/超时兜底：清空 active 并拒绝所有等待者。
 * 解除"WS 断开后 pending 永不 settle → endTraining 反复超时失败"的死锁。
 */
function settleAllPending(bus: MessageBus, error: string) {
  const state = getPendingState(bus);
  state.active.clear();
  for (const waiter of [...state.waiters]) {
    window.clearTimeout(waiter.timer);
    state.waiters.delete(waiter);
    waiter.reject(new Error(error));
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
        // 超时即视为这批工具结果已不可得：清空 active，后续结束尝试不再被卡住
        settleAllPending(bus, "训练内容保存超时");
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

  // WS 断线时立即失败 settle：不等 10s 超时，让结束训练/重试尽快得到明确反馈
  useEffect(() => {
    return subscribeWSConnection((connected) => {
      if (connected) return;
      const state = getPendingState(bus);
      if (state.active.size === 0) return;
      settleAllPending(bus, "网络连接已断开，工具操作结果可能未保存");
    });
  }, [bus]);

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

    // 查体 → 情绪桥接（feedback id=30）：工具结果携带 emotion 时驱动情绪条
    const emotion =
      msg.data && typeof msg.data === "object"
        ? (msg.data as Record<string, unknown>).emotion
        : undefined;
    if (emotion && typeof emotion === "object") {
      bus.emit(
        "emotion:changed",
        emotion as {
          trust?: number;
          anxiety?: number;
          irritation?: number;
          cooperation?: number;
          dominant_state?: string;
        },
      );
    }
  });
}
