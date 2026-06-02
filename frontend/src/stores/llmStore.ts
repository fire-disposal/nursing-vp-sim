import { create } from "zustand";
import type { LLMState } from "../types/store";

const useLLMStore = create<LLMState>((set) => ({
  tab: "monitor",
  setTab: (tab: string): void => set({ tab }),
}));

export default useLLMStore;
