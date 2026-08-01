import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessageBus } from "@/engine/MessageBus";
import type { MessageBus } from "@/engine/types";
import { useToolBridge, waitForPendingToolRequests } from "@/hooks/useToolBridge";
import type { TrainingWSMessage } from "@/hooks/useTrainingWS";

const wsMock = vi.hoisted(() => ({
  handler: null as ((message: TrainingWSMessage) => void) | null,
  sendTool: vi.fn(() => "request-1"),
}));

vi.mock("@/hooks/useTrainingWS", () => ({
  useTrainingWS: (handler?: (message: TrainingWSMessage) => void) => {
    if (handler) wsMock.handler = handler;
    return { send: vi.fn(), sendTool: wsMock.sendTool };
  },
}));

function Bridge({ bus }: { bus: MessageBus }) {
  useToolBridge(bus);
  return null;
}

afterEach(() => {
  wsMock.handler = null;
  wsMock.sendTool.mockClear();
});

describe("useToolBridge", () => {
  it("tracks a request until the matching committed result arrives", async () => {
    const bus = createMessageBus();
    const results: Array<Record<string, unknown>> = [];
    bus.on("tool:result", (result: Record<string, unknown>) => results.push(result));
    render(<Bridge bus={bus} />);

    act(() => {
      bus.emit("tool:invoke", {
        tool: "nursing_record",
        action: "save",
        params: { sheet_data: { subjective: "头晕" } },
        recordId: 42,
      });
    });

    expect(wsMock.sendTool).toHaveBeenCalledTimes(1);
    const pending = waitForPendingToolRequests(bus);

    await act(async () => {
      wsMock.handler?.({
        type: "tool:result",
        request_id: "request-1",
        tool: "nursing_record",
        action: "save",
        ok: true,
        data: { saved: true },
      });
      await pending;
    });

    expect(results).toEqual([
      {
        requestId: "request-1",
        tool: "nursing_record",
        action: "save",
        ok: true,
        data: { saved: true },
        error: undefined,
      },
    ]);
  });

  it("forwards exam emotion payload as emotion:changed (feedback id=30)", () => {
    const bus = createMessageBus();
    const emotions: Array<Record<string, unknown>> = [];
    bus.on("emotion:changed", (e: Record<string, unknown>) => emotions.push(e));
    render(<Bridge bus={bus} />);

    act(() => {
      wsMock.handler?.({
        type: "tool:result",
        request_id: "request-2",
        tool: "physical_exam",
        action: "measure",
        ok: true,
        data: {
          op_type: "temp",
          result: { label: "体温", value: "38.5", unit: "°C" },
          emotion: { anxiety: 0.54, irritation: 0.35, cooperation: 0.48, trust: 0.5, dominant_state: "anxious_guarded" },
        },
      });
    });

    expect(emotions).toEqual([
      { anxiety: 0.54, irritation: 0.35, cooperation: 0.48, trust: 0.5, dominant_state: "anxious_guarded" },
    ]);

    // 无 emotion 字段的工具结果不得触发情绪事件
    act(() => {
      wsMock.handler?.({
        type: "tool:result",
        request_id: "request-3",
        tool: "physical_exam",
        action: "measure",
        ok: true,
        data: { op_type: "hr", result: { label: "心率", value: "72" } },
      });
    });
    expect(emotions).toHaveLength(1);
  });
});
