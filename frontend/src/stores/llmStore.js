import { create } from "zustand";

const useLLMStore = create((set) => ({
  tab: "monitor",
  setTab: (tab) => set({ tab }),
}));

export default useLLMStore;
