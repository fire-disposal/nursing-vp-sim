import { create } from "zustand";
import { persist } from "zustand/middleware";

function readLegacyBoolean(key: string): boolean {
	try {
		return localStorage.getItem(key) === "1";
	} catch {
		return false;
	}
}

interface UiPrefsState {
	mobileHintDismissed: boolean;
	quickPromptsCollapsed: boolean;
	feedbackChartsOpen: boolean;
	/** 桌面侧栏折叠状态（跨会话保留） */
	sidebarCollapsed: boolean;
	setMobileHintDismissed: (value: boolean) => void;
	setQuickPromptsCollapsed: (value: boolean) => void;
	setFeedbackChartsOpen: (value: boolean) => void;
	setSidebarCollapsed: (value: boolean) => void;
}

export const useUiPrefsStore = create<UiPrefsState>()(
	persist(
		(set) => ({
			mobileHintDismissed: readLegacyBoolean("admin:mobileHintDismissed"),
			quickPromptsCollapsed: readLegacyBoolean("training:quickPromptsCollapsed"),
			feedbackChartsOpen: readLegacyBoolean("admin:feedbackChartsOpen"),
			sidebarCollapsed: false,
			setMobileHintDismissed: (mobileHintDismissed) =>
				set({ mobileHintDismissed }),
			setQuickPromptsCollapsed: (quickPromptsCollapsed) =>
				set({ quickPromptsCollapsed }),
			setFeedbackChartsOpen: (feedbackChartsOpen) =>
				set({ feedbackChartsOpen }),
			setSidebarCollapsed: (sidebarCollapsed) =>
				set({ sidebarCollapsed }),
		}),
		{
			name: "nursing-ui-prefs",
			version: 1,
			migrate: (persisted) => persisted as UiPrefsState,
		},
	),
);
