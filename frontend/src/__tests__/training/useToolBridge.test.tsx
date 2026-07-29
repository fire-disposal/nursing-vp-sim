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
});
