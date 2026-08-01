import { useEffect, useState } from "react";

/**
 * Minimal CSS media query hook — use for one-off breakpoints only.
 * For most cases, prefer useLayoutMode which provides standardised
 * "desktop / phone" modes with a single breakpoint source of truth.
 */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		const mql = window.matchMedia(query);
		const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
		setMatches(mql.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, [query]);

	return matches;
}
