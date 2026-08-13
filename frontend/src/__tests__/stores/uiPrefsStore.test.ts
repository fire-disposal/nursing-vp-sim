import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiPrefsStore } from "@/stores/uiPrefsStore";

async function freshStore() {
	// 旧实例的 persist 会在每次 setState 时写入 nursing-ui-prefs；
	// 新模块会从该键 rehydrate 并覆盖初始值，需先清掉。
	localStorage.removeItem("nursing-ui-prefs");
	vi.resetModules();
	const mod = await import("@/stores/uiPrefsStore");
	return mod.useUiPrefsStore;
}

beforeEach(() => {
	localStorage.clear();
	useUiPrefsStore.setState({
		mobileHintDismissed: false,
		quickPromptsCollapsed: false,
		feedbackChartsOpen: false,
	});
});

describe("uiPrefsStore", () => {
	it("reads legacy boolean flags from localStorage at init", async () => {
		localStorage.setItem("admin:mobileHintDismissed", "1");
		localStorage.setItem("training:quickPromptsCollapsed", "1");
		localStorage.setItem("admin:feedbackChartsOpen", "0");
		const store = await freshStore();
		const s = store.getState();
		expect(s.mobileHintDismissed).toBe(true);
		expect(s.quickPromptsCollapsed).toBe(true);
		expect(s.feedbackChartsOpen).toBe(false);
	});

	it("setters update flags", () => {
		const s = useUiPrefsStore.getState();
		s.setMobileHintDismissed(true);
		s.setQuickPromptsCollapsed(true);
		s.setFeedbackChartsOpen(true);
		const next = useUiPrefsStore.getState();
		expect(next.mobileHintDismissed).toBe(true);
		expect(next.quickPromptsCollapsed).toBe(true);
		expect(next.feedbackChartsOpen).toBe(true);
	});
});
