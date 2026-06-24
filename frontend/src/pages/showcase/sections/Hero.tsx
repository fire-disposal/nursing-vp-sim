import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import ScreenshotPlaceholder from "../components/ScreenshotPlaceholder";
import { CTA_HREF, CTA_LABEL, HERO_SUBTITLE, HERO_TITLE, PRODUCT_NAME } from "../data";
import { ensureGsap, prefersReducedMotion } from "../lib/gsap";

export default function Hero() {
	const root = useRef<HTMLElement>(null);
	const shot = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (prefersReducedMotion() || !root.current) return;
		const { gsap } = ensureGsap();
		const ctx = gsap.context(() => {
			const mm = gsap.matchMedia();
			mm.add("(min-width: 768px)", () => {
				gsap.to(shot.current, {
					yPercent: -12,
					ease: "none",
					scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true, invalidateOnRefresh: true },
				});
			});
		}, root);
		return () => ctx.revert();
	}, []);

	return (
		<section
			ref={root}
			className="relative flex min-h-[100dvh] items-center overflow-hidden pt-24"
		>
			<div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-6 md:grid-cols-2">
				<div className="flex flex-col gap-6">
					<span className="text-sm font-medium text-primary">{PRODUCT_NAME}</span>
					<h1 className="text-4xl font-bold leading-tight tracking-tight md:text-6xl [font-family:'Geist_Variable',sans-serif]">
						{HERO_TITLE}
					</h1>
					<p className="max-w-[60ch] text-lg leading-relaxed text-muted-foreground">
						{HERO_SUBTITLE}
					</p>
					<div>
						<Link to={CTA_HREF} className={buttonVariants({ size: "lg" })}>
							{CTA_LABEL}
						</Link>
					</div>
				</div>
				<div ref={shot} className="relative">
					{/* TODO: 替换为真实系统截图 */}
					<ScreenshotPlaceholder width={1440} height={900} label="1440×900（产品总览）" />
				</div>
			</div>
		</section>
	);
}
