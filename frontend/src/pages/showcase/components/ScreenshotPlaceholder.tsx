import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

interface ScreenshotPlaceholderProps {
	width: number;
	height: number;
	id?: string;
	className?: string;
}

function useTheme(): "light" | "dark" {
	const [theme, setTheme] = useState<"light" | "dark">(() =>
		document.documentElement.classList.contains("dark") ? "dark" : "light",
	);

	useEffect(() => {
		const observer = new MutationObserver(() => {
			setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
		});
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	return theme;
}

const SCREENSHOTS: Record<string, { light: string; dark: string }> = {
	hero: {
		light: "/screenshots/hero-light.png",
		dark: "/screenshots/hero-dark.png",
	},
};

function ScreenshotImage({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
	const [loaded, setLoaded] = useState(false);
	const keyRef = useRef(src);

	if (keyRef.current !== src) {
		keyRef.current = src;
		if (loaded) setLoaded(false);
	}

	return (
		<div
			style={{ aspectRatio: `${width} / ${height}` }}
			className="relative w-full overflow-hidden rounded-2xl bg-muted/10"
		>
			<img
				src={src}
				alt={alt}
				loading="lazy"
				onLoad={() => setLoaded(true)}
				className={cn(
					"block size-full object-cover transition-all duration-700 ease-out",
					loaded ? "opacity-100 scale-100" : "opacity-0 scale-[1.02]",
				)}
			/>
		</div>
	);
}

export default function ScreenshotPlaceholder({
	width,
	height,
	id,
	className,
}: ScreenshotPlaceholderProps) {
	const theme = useTheme();
	const screenshot = id ? SCREENSHOTS[id] : undefined;

	if (screenshot) {
		return (
			<div className={className}>
				<ScreenshotImage
					src={theme === "dark" ? screenshot.dark : screenshot.light}
					alt={`系统截图 - ${id}`}
					width={width}
					height={height}
				/>
			</div>
		);
	}

	return (
		<div
			style={{ aspectRatio: `${width} / ${height}` }}
			className={`flex w-full items-center justify-center rounded-2xl bg-muted/15 ${className ?? ""}`}
		>
			<span className="text-xs text-muted-foreground/40">{width}×{height}</span>
		</div>
	);
}
