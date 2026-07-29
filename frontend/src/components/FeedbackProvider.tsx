import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFeedbackStore } from "@/stores/feedbackStore";
import FeedbackModal from "./FeedbackModal";

interface FeedbackContextValue {
	openFeedback: () => void;
	isOpen: boolean;
	showPrompt: boolean;
	setShowPrompt: (v: boolean) => void;
	closeFeedback: () => void;
}

export function FeedbackHost() {
	const isOpen = useFeedbackStore((s) => s.isOpen);
	const closeFeedback = useFeedbackStore((s) => s.closeFeedback);
	const markSubmitted = useFeedbackStore((s) => s.markSubmitted);
	const initializePrompt = useFeedbackStore((s) => s.initializePrompt);

	useEffect(() => {
		initializePrompt();
	}, [initializePrompt]);

	return (
		<FeedbackModal
			open={isOpen}
			onClose={closeFeedback}
			onSubmitted={markSubmitted}
		/>
	);
}

export function useFeedback(): FeedbackContextValue {
	return useFeedbackStore(
		useShallow((s) => ({
			openFeedback: s.openFeedback,
			isOpen: s.isOpen,
			showPrompt: s.showPrompt,
			setShowPrompt: s.setShowPrompt,
			closeFeedback: s.closeFeedback,
		})),
	);
}
