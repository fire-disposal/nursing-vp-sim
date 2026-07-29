import { create } from "zustand";
import { persist } from "zustand/middleware";

function readLegacyBoolean(key: string): boolean {
	try {
		return localStorage.getItem(key) === "1";
	} catch {
		return false;
	}
}

function readLegacyNavGroups(): Record<string, boolean> {
	const groups: Record<string, boolean> = {};
	try {
		for (let i = 0; i < localStorage.length; i += 1) {
			const key = localStorage.key(i);
			if (!key?.startsWith("navgroup-")) continue;
			groups[key.slice("navgroup-".length)] = localStorage.getItem(key) === "true";
		}
	} catch {
		return {};
	}
	return groups;
}

interface UiPrefsState {
	mobileHintDismissed: boolean;
	quickPromptsCollapsed: boolean;
	feedbackChartsOpen: boolean;
	navGroupsOpen: Record<string, boolean>;
	setMobileHintDismissed: (value: boolean) => void;
	setQuickPromptsCollapsed: (value: boolean) => void;
	setFeedbackChartsOpen: (value: boolean) => void;
	setNavGroupOpen: (key: string, value: boolean) => void;
	getNavGroupOpen: (key: string, defaultOpen: boolean) => boolean;
}

export const useUiPrefsStore = create<UiPrefsState>()(
	persist(
		(set, get) => ({
			mobileHintDismissed: readLegacyBoolean("admin:mobileHintDismissed"),
			quickPromptsCollapsed: readLegacyBoolean(
				"training:quickPromptsCollapsed",
			),
			feedbackChartsOpen: readLegacyBoolean("admin:feedbackChartsOpen"),
			navGroupsOpen: readLegacyNavGroups(),
			setMobileHintDismissed: (mobileHintDismissed) =>
				set({ mobileHintDismissed }),
			setQuickPromptsCollapsed: (quickPromptsCollapsed) =>
				set({ quickPromptsCollapsed }),
			setFeedbackChartsOpen: (feedbackChartsOpen) =>
				set({ feedbackChartsOpen }),
			setNavGroupOpen: (key, value) =>
				set((state) => ({
					navGroupsOpen: { ...state.navGroupsOpen, [key]: value },
				})),
			getNavGroupOpen: (key, defaultOpen) =>
				get().navGroupsOpen[key] ?? defaultOpen,
		}),
		{
			name: "nursing-ui-prefs",
			version: 1,
			migrate: (persisted) => persisted as UiPrefsState,
		},
	),
);
