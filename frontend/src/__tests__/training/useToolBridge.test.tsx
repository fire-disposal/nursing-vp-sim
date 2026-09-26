import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessageBus } from "@/engine/MessageBus";
import type { MessageBus } from "@/engine/types";
import { useToolBridge, waitForPendingToolCommands } from "@/hooks/useToolBridge";

const apiMock = vi.hoisted(() => ({
  postToolCommand: vi.fn(),
}));

const promiseConstructor = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
  };
};

vi.mock("@/api/training", () => ({
  postToolCommand: apiMock.postToolCommand,
}));

vi.mock("@/hooks/useTrainingWS", () => ({
  subscribeWSConnection: () => () => {},
}));

function Bridge({ bus }: { bus: MessageBus }) {
  useToolBridge(bus);
  return null;
}

afterEach(() => {
  apiMock.postToolCommand.mockReset();
});

describe("useToolBridge (HTTP 指令面)", () => {
  it("sends cmd= tool.action with idem_key and revision=null on first invoke", async () => {
    const bus = createMessageBus();
    render(<Bridge bus={bus} />);

    apiMock.postToolCommand.mockResolvedValue({
      ok: true,
      data: { hr: 92 },
      scene: { vitals: { hr: 92 } },
      error: "",
      revision: 3,
    });

    await act(async () => {
      bus.emit("tool:invoke", { tool: "physical_exam", action: "measure", params: { op_type: "hr" }, recordId: 7 });
    });

    const [recordId, body] = apiMock.postToolCommand.mock.calls[0];
    expect(recordId).toBe(7);
    expect(body.cmd).toBe("physical_exam.measure");
    expect(body.revision).toBeNull();
    expect(body.idem_key).toBeTruthy();
  });

  it("emits tool:result for components (contract unchanged)", async () => {
    const bus = createMessageBus();
    const results: Array<Record<string, unknown>> = [];
    bus.on("tool:result", (r: Record<string, unknown>) => results.push(r));
    render(<Bridge bus={bus} />);

    apiMock.postToolCommand.mockResolvedValue({
      ok: true,
      data: { hr: 92 },
      scene: { vitals: { hr: 92 } },
      error: "",
      revision: 3,
    });

    await act(async () => {
      bus.emit("tool:invoke", { tool: "physical_exam", action: "measure", params: {}, recordId: 7 });
    });

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].data).toEqual({ hr: 92 });
  });

  it("reuses the server revision on subsequent invokes (optimistic concurrency)", async () => {
    const bus = createMessageBus();
    render(<Bridge bus={bus} />);

    apiMock.postToolCommand.mockResolvedValue({
      ok: true,
      data: {},
      scene: null,
      error: "",
      revision: 5,
    });

    await act(async () => {
      bus.emit("tool:invoke", { tool: "physical_exam", action: "measure", params: {}, recordId: 7 });
    });
    await act(async () => {
      bus.emit("tool:invoke", { tool: "physical_exam", action: "measure", params: {}, recordId: 7 });
    });

    expect(apiMock.postToolCommand).toHaveBeenCalledTimes(2);
    const second = apiMock.postToolCommand.mock.calls[1][1];
    expect(second.revision).toBe(5);
  });

  it("waits for a pending save before allowing submission to continue", async () => {
    const bus = createMessageBus();
    render(<Bridge bus={bus} />);
    const save = promiseConstructor.withResolvers<{
      ok: boolean;
      data: Record<string, unknown>;
      scene: null;
      error: string;
      revision: number;
    }>();
    apiMock.postToolCommand.mockReturnValue(save.promise);

    bus.emit("tool:invoke", {
      tool: "nursing_record",
      action: "save",
      params: { sheet: { subjective: "头晕" } },
      recordId: 7,
    });
    let completed = false;
    const barrier = waitForPendingToolCommands(7).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    save.resolve({
      ok: true,
      data: { sheet_data: { subjective: "头晕" } },
      scene: null,
      error: "",
      revision: 1,
    });
    await act(async () => {
      await barrier;
    });
    expect(completed).toBe(true);
  });

  it("只让护理记录写入的失败中断屏障", async () => {
    const bus = createMessageBus();
    render(<Bridge bus={bus} />);

    // 查体失败：面板自行提示，不应拦住交卷/离开
    apiMock.postToolCommand.mockRejectedValueOnce(new Error("查体请求失败"));
    bus.emit("tool:invoke", { tool: "physical_exam", action: "measure", params: { op_type: "hr" }, recordId: 7 });
    await expect(waitForPendingToolCommands(7, "nursing_record")).resolves.toBeUndefined();

    // 护理记录落盘失败：必须抛给交卷/离开调用方
    apiMock.postToolCommand.mockRejectedValueOnce(new Error("护理记录写入失败"));
    bus.emit("tool:invoke", { tool: "nursing_record", action: "save", params: {}, recordId: 7 });
    await expect(waitForPendingToolCommands(7, "nursing_record")).rejects.toThrow("护理记录写入失败");
  });

  it("surfaces errors as tool:result ok=false", async () => {
    const bus = createMessageBus();
    const results: Array<Record<string, unknown>> = [];
    bus.on("tool:result", (r: Record<string, unknown>) => results.push(r));
    render(<Bridge bus={bus} />);

    apiMock.postToolCommand.mockRejectedValue(new Error("network down"));
    await act(async () => {
      bus.emit("tool:invoke", { tool: "nursing_record", action: "save", params: {}, recordId: 7 });
    });

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toBeTruthy();
  });
});
