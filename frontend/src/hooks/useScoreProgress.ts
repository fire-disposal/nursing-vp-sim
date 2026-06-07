import { useEffect, useRef, useState } from "react";

export function useScoreProgress(isActive: boolean) {
  const [progress, setProgress] = useState(0);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(0);

  useEffect(() => {
    if (!isActive) return;
    setProgress(0);
    speedRef.current = 100 / (15 * 20);

    progressIntervalRef.current = setInterval(() => {
      setProgress((prev) => {
        const next = prev + speedRef.current;
        return Math.min(next, 100);
      });
    }, 50);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isActive]);

  const fastForward = () => {
    speedRef.current = 8;
  };

  return { progress, fastForward };
}
