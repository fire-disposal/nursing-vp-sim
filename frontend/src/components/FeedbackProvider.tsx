import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import FeedbackModal from "./FeedbackModal";

interface FeedbackContextValue {
  openFeedback: () => void;
  isOpen: boolean;
  showPrompt: boolean;
  setShowPrompt: (v: boolean) => void;
  closeFeedback: () => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const STORAGE_KEY = "feedback_v1_prompted";

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const prompted = localStorage.getItem(STORAGE_KEY);
    if (!prompted) {
      setShowPrompt(true);
    }
  }, []);

  const openFeedback = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeFeedback = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "1");
    setIsOpen(false);
    setShowPrompt(false);
  }, []);

  const handleSubmitted = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "1");
    setShowPrompt(false);
  }, []);

  return (
    <FeedbackContext.Provider value={{ openFeedback, isOpen, showPrompt, setShowPrompt, closeFeedback }}>
      {children}
      <FeedbackModal open={isOpen} onClose={closeFeedback} onSubmitted={handleSubmitted} />
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be inside FeedbackProvider");
  return ctx;
}
