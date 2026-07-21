import { type ReactNode, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../gsap";

interface RevealProps {
	children: ReactNode;
	delay?: number;
	className?: string;
}

export default function Reveal({ children, delay = 0, className }: RevealProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [shown, setShown] = useState(
		() => prefersReducedMotion() || typeof IntersectionObserver === "undefined",
	);

	useEffect(() => {
		if (shown || !ref.current) return;
		const el = ref.current;
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						setShown(true);
						io.disconnect();
					}
				}
			},
			{ threshold: 0.2 },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [shown]);

	return (
		<div
			ref={ref}
			className={className}
			style={{
				opacity: shown ? 1 : 0,
				transform: shown ? "none" : "translateY(24px)",
				transition: `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
			}}
		>
			{children}
		</div>
	);
}
