/** Layout mode hook — single source of truth for responsive breakpoints. */

import { useEffect, useState } from "react";

export type LayoutMode = "desktop" | "tablet" | "phone";

const BP = { phone: 480, tablet: 768, desktop: 1024 } as const;

function getMode(w: number): LayoutMode {
	if (w < BP.desktop) return "phone";
	return "desktop";
}

export function useLayoutMode(): LayoutMode {
	const [mode, setMode] = useState<LayoutMode>(() =>
		typeof window === "undefined" ? "desktop" : getMode(window.innerWidth),
	);

	useEffect(() => {
		const onResize = () => setMode(getMode(window.innerWidth));
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	return mode;
}

export function useIsMobile(): boolean {
	const mode = useLayoutMode();
	return mode !== "desktop";
}
