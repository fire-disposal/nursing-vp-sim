import { type ReactNode, useEffect, useRef, useState } from "react";

interface TooltipProps {
	content: string;
	children: ReactNode;
}

export default function Tooltip({ content, children }: TooltipProps) {
	const [show, setShow] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleEnter = () => {
		if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => setShow(true), 400);
	};
	const handleLeave = () => {
		if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
		setShow(false);
	};

	useEffect(() => {
		return () => {
			if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
		};
	}, []);

	return (
		<span
			className="relative inline-flex"
			onMouseEnter={handleEnter}
			onMouseLeave={handleLeave}
		>
			{children}
			{show && (
				<span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-gray-800 text-white text-[0.7rem] leading-tight whitespace-nowrap z-50 pointer-events-none shadow-lg">
					{content}
					<span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
				</span>
			)}
		</span>
	);
}
