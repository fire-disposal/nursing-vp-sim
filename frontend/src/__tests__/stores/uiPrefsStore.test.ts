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
		navGroupsOpen: {},
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

	it("reads legacy nav group flags at init", async () => {
		localStorage.setItem("navgroup-cases", "true");
		localStorage.setItem("navgroup-users", "false");
		localStorage.setItem("navgroup-other", "true");
		const store = await freshStore();
		expect(store.getState().navGroupsOpen).toEqual({ cases: true, users: false, other: true });
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

	it("setNavGroupOpen merges into navGroupsOpen", () => {
		useUiPrefsStore.setState({ navGroupsOpen: { cases: true } });
		useUiPrefsStore.getState().setNavGroupOpen("users", true);
		useUiPrefsStore.getState().setNavGroupOpen("cases", false);
		expect(useUiPrefsStore.getState().navGroupsOpen).toEqual({ cases: false, users: true });
	});

	it("getNavGroupOpen falls back to default", () => {
		expect(useUiPrefsStore.getState().getNavGroupOpen("missing", true)).toBe(true);
		useUiPrefsStore.setState({ navGroupsOpen: { missing: false } });
		expect(useUiPrefsStore.getState().getNavGroupOpen("missing", true)).toBe(false);
	});
});
