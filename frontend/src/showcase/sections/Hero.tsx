import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import LiveChatSimulation from "../components/LiveChatSimulation";
import VideoModal from "../components/VideoModal";
import VirtualPatientMaskText from "../components/VirtualPatientMaskText";
import { CTA_HREF, PRODUCT_NAME } from "../data";
import { ensureGsap, prefersReducedMotion } from "../lib/gsap";

export default function Hero() {
	const root = useRef<HTMLElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const ctaRef = useRef<HTMLDivElement>(null);
	const [videoOpen, setVideoOpen] = useState(false);

	useEffect(() => {
		if (prefersReducedMotion() || !root.current) return;
		const { gsap } = ensureGsap();
		const ctx = gsap.context(() => {
				gsap.to(panel.current, {
					yPercent: -8,
					ease: "none",
					scrollTrigger: {
						trigger: root.current,
						start: "top top",
						end: "bottom top",
						scrub: true,
						invalidateOnRefresh: true,
					},
				});

			// Entrance animations
			const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
			tl.from(titleRef.current, { y: 40, opacity: 0, duration: 1 })
				.from(ctaRef.current, { y: 20, opacity: 0, duration: 0.8 }, "-=0.6")
					.from(panel.current, { scale: 0.98, opacity: 0, duration: 1.1 }, "-=1");
		}, root);
		return () => ctx.revert();
	}, []);

	return (
		<>
			<section
				ref={root}
				className="relative flex min-h-[calc(100dvh-64px)] items-center justify-center overflow-hidden pt-[calc(2.75rem+5px)] pb-16"
			>
			<div className="pointer-events-none absolute inset-0 -z-10">
				<div className="absolute left-1/2 top-0 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-primary/5 blur-[140px]" />
				<div className="absolute right-0 top-1/3 h-[18rem] w-[18rem] rounded-full bg-blue-500/6 blur-[120px]" />
			</div>

			<div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-14 px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-20">
				<div className="flex flex-col gap-6 pt-1">
					<div className="inline-flex">
						<span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary ring-1 ring-inset ring-primary/20">
							{PRODUCT_NAME}
						</span>
					</div>
					<h1
						ref={titleRef}
						className="text-4xl font-bold leading-[1.03] tracking-tight text-foreground md:text-6xl lg:text-[5.35rem] [font-family:'Geist_Variable',sans-serif]"
					>
						把 LLM 做成可教学、可评估的
						<VirtualPatientMaskText />
					</h1>
					<div className="flex flex-wrap gap-3">
						{["5 个面板", "19 项评分", "6 种情绪", "教材溯源"].map((item) => (
							<span
								key={item}
								className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-medium tracking-wide text-foreground/75"
							>
								{item}
							</span>
						))}
					</div>
					<p className="max-w-[46ch] text-sm leading-relaxed text-muted-foreground/80 md:text-base">
						从问诊提问、病史暴露到评分证据回链，训练过程、结果和依据都能直接查看。
					</p>
					<div ref={ctaRef} className="flex flex-wrap items-center gap-5">
						<Link
							to={CTA_HREF}
							className={buttonVariants({
								size: "lg",
								className: "h-14 rounded-full px-10 text-lg shadow-xl shadow-primary/20",
							})}
						>
							立即体验
						</Link>
							{/*
						<button
							type="button"
							onClick={() => setVideoOpen(true)}
							className="group flex items-center gap-3 text-sm font-semibold transition-colors hover:text-primary"
						>
							<div className="flex size-10 items-center justify-center rounded-full bg-background ring-1 ring-border transition-all group-hover:ring-primary/50">
								<div className="size-0 border-b-[6px] border-l-[10px] border-t-[6px] border-b-transparent border-l-current border-t-transparent ml-1" />
							</div>
							演示视频
						</button>
					*/}
					</div>
				</div>
				<div ref={panel} className="relative lg:pt-8">
					<div className="absolute -inset-8 rounded-[2rem] bg-gradient-to-tr from-primary/10 via-transparent to-blue-500/10 blur-3xl opacity-60" />
					<div className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-card/80 p-5 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)] backdrop-blur-sm md:p-6">
						<LiveChatSimulation />
					</div>
				</div>
			</div>
		</section>
			<VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} src="/demo.mp4" />
		</>
	);
}
