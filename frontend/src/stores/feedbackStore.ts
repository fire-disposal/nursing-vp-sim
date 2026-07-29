import { create } from "zustand";

const STORAGE_KEY = "feedback_v1_prompted";

function readPrompted(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function markPrompted() {
	try {
		localStorage.setItem(STORAGE_KEY, "1");
	} catch {
		// localStorage unavailable
	}
}

interface FeedbackState {
	isOpen: boolean;
	showPrompt: boolean;
	initializePrompt: () => void;
	openFeedback: () => void;
	closeFeedback: () => void;
	setShowPrompt: (value: boolean) => void;
	markSubmitted: () => void;
}

export const useFeedbackStore = create<FeedbackState>()((set) => ({
	isOpen: false,
	showPrompt: false,
	initializePrompt: () => {
		set({ showPrompt: !readPrompted() });
	},
	openFeedback: () => set({ isOpen: true }),
	closeFeedback: () => {
		markPrompted();
		set({ isOpen: false, showPrompt: false });
	},
	setShowPrompt: (showPrompt) => set({ showPrompt }),
	markSubmitted: () => {
		markPrompted();
		set({ showPrompt: false });
	},
}));
