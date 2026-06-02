import { describe, it, expect } from "vitest";
import { create } from "zustand";

describe("llmStore", () => {
  it("initializes with tab set to 'monitor'", async () => {
    const { default: useLLMStore } = await import("@/stores/llmStore");
    expect(useLLMStore.getState().tab).toBe("monitor");
  });

  it("setTab changes the active tab", async () => {
    const { default: useLLMStore } = await import("@/stores/llmStore");
    useLLMStore.getState().setTab("api");
    expect(useLLMStore.getState().tab).toBe("api");
  });
});

describe("gradesClassesStore", () => {
  it("initializes with empty grades and classes", async () => {
    const { default: useGradesClassesStore } = await import("@/stores/gradesClassesStore");
    const state = useGradesClassesStore.getState();
    expect(state.grades).toEqual([]);
    expect(state.classes).toEqual([]);
    expect(state.loading).toBe(false);
  });
});
