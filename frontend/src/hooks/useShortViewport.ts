import { useEffect, useState } from "react";

/**
 * Detects short viewports (landscape phones, height < 500px).
 * Used to hide bottom tab bar and compact top nav on devices
 * where vertical screen real estate is at a premium.
 */
export function useShortViewport(): boolean {
	const [isShort, setIsShort] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.innerHeight < 500;
	});

	useEffect(() => {
		const mq = window.matchMedia("(max-height: 500px)");
		const onChange = (e: MediaQueryListEvent) => setIsShort(e.matches);
		setIsShort(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	return isShort;
}
