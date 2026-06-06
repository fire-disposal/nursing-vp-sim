import { useCallback, useRef, useState } from "react";

export interface UseTypingFreezeReturn {
  typingFrozen: boolean;
  markTyping: () => void;
}

export function useTypingFreeze(freezeMs = 2000): UseTypingFreezeReturn {
  const [typingFrozen, setTypingFrozen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markTyping = useCallback(() => {
    setTypingFrozen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTypingFrozen(false), freezeMs);
  }, [freezeMs]);

  return { typingFrozen, markTyping };
}
