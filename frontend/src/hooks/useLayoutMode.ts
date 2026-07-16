import { useEffect, useState } from "react";

export type LayoutMode = "desktop" | "tablet" | "phone";

const MOBILE_BP = 768;

function getMode(w: number): LayoutMode {
	return w < MOBILE_BP ? "phone" : "desktop";
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
