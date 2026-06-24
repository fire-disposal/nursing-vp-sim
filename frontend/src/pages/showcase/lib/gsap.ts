import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;

export function ensureGsap() {
	if (!registered && typeof window !== "undefined") {
		gsap.registerPlugin(ScrollTrigger);
		registered = true;
	}
	return { gsap, ScrollTrigger };
}

export function prefersReducedMotion(): boolean {
	return (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function" ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export { gsap, ScrollTrigger };
