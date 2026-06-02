import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import FeedbackModal from "./FeedbackModal";

interface FeedbackContextType {
  openFeedback: () => void;
  isOpen: boolean;
  showPrompt: boolean;
  setShowPrompt: (v: boolean) => void;
  closeFeedback: () => void;
}

const FeedbackContext = createContext<FeedbackContextType | null>(null);

const STORAGE_KEY = "feedback_v1_prompted";

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const prompted = localStorage.getItem(STORAGE_KEY);
    if (!prompted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

// eslint-disable-next-line react-refresh/only-export-components
export function useFeedback(): FeedbackContextType {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be inside FeedbackProvider");
  return ctx;
}
