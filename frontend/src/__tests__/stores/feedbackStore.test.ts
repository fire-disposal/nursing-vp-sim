import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFeedbackStore } from "@/stores/feedbackStore";

const STORAGE_KEY = "feedback_v1_prompted";

function seedStorage(value: string | null): void {
	if (value === null) {
		localStorage.removeItem(STORAGE_KEY);
	} else {
		localStorage.setItem(STORAGE_KEY, value);
	}
}

beforeEach(() => {
	seedStorage(null);
	useFeedbackStore.setState({ isOpen: false, showPrompt: false });
});

describe("feedbackStore", () => {
	it("initial state", () => {
		const s = useFeedbackStore.getState();
		expect(s.isOpen).toBe(false);
		expect(s.showPrompt).toBe(false);
	});

	it("initializePrompt shows prompt when never prompted", () => {
		useFeedbackStore.getState().initializePrompt();
		expect(useFeedbackStore.getState().showPrompt).toBe(true);
	});

	it("initializePrompt hides prompt when already prompted", () => {
		seedStorage("1");
		useFeedbackStore.getState().initializePrompt();
		expect(useFeedbackStore.getState().showPrompt).toBe(false);
	});

	it("openFeedback opens dialog", () => {
		useFeedbackStore.getState().openFeedback();
		expect(useFeedbackStore.getState().isOpen).toBe(true);
	});

	it("closeFeedback marks prompted and closes", () => {
		useFeedbackStore.setState({ isOpen: true, showPrompt: true });
		useFeedbackStore.getState().closeFeedback();
		const s = useFeedbackStore.getState();
		expect(s.isOpen).toBe(false);
		expect(s.showPrompt).toBe(false);
		expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("markSubmitted marks prompted and hides prompt", () => {
		useFeedbackStore.setState({ showPrompt: true });
		useFeedbackStore.getState().markSubmitted();
		expect(useFeedbackStore.getState().showPrompt).toBe(false);
		expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("setShowPrompt overrides", () => {
		useFeedbackStore.getState().setShowPrompt(true);
		expect(useFeedbackStore.getState().showPrompt).toBe(true);
	});

	it("survives localStorage unavailability", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("denied");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("denied");
		});
		useFeedbackStore.getState().initializePrompt();
		useFeedbackStore.getState().closeFeedback();
		expect(useFeedbackStore.getState().isOpen).toBe(false);
		vi.restoreAllMocks();
	});
});
