import { useEffect, useRef } from "react";
import FeatureFull from "../components/layouts/FeatureFull";
import FeatureSplit from "../components/layouts/FeatureSplit";
import Reveal from "../components/Reveal";
import ScreenshotPlaceholder from "../components/ScreenshotPlaceholder";
import { HIGHLIGHTS, type Highlight } from "../data";
import { ensureGsap, prefersReducedMotion } from "../lib/gsap";

function shot(h: Highlight) {
	if (!h.screenshot) return null;
	return (
		/* TODO: 替换为真实系统截图 */
		<ScreenshotPlaceholder
			width={h.screenshot.width}
			height={h.screenshot.height}
			label={h.screenshot.label}
		/>
	);
}

function BentoHighlight({ h }: { h: Highlight }) {
	const Icon = h.icon;
	return (
		<Reveal>
			<div className="rounded-2xl border border-border bg-card p-8">
				<div className="mb-5 flex items-center gap-3">
					<div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10">
						<Icon size={22} strokeWidth={1.5} className="text-primary" />
					</div>
					<h3 className="text-xl font-bold tracking-tight [font-family:'Geist_Variable',sans-serif]">
						{h.title}
					</h3>
				</div>
				<p className="mb-5 leading-relaxed text-muted-foreground">{h.body}</p>
				<div className="flex flex-wrap gap-2">
					{h.points.map((p) => (
						<span
							key={p}
							className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground/80"
						>
							{p}
						</span>
					))}
				</div>
			</div>
		</Reveal>
	);
}

function StickyHighlight({ h }: { h: Highlight }) {
	const root = useRef<HTMLDivElement>(null);
	const card = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (prefersReducedMotion() || !root.current) return;
		const { gsap } = ensureGsap();
		const ctx = gsap.context(() => {
			const mm = gsap.matchMedia();
			mm.add("(min-width: 768px)", () => {
				gsap.fromTo(
					card.current,
					{ scale: 0.96, opacity: 0.7 },
					{
						scale: 1,
						opacity: 1,
						ease: "none",
						scrollTrigger: { trigger: root.current, start: "top 80%", end: "top 30%", scrub: true },
					},
				);
			});
		}, root);
		return () => ctx.revert();
	}, []);

	const Icon = h.icon;
	return (
		<div ref={root}>
			<div ref={card} className="rounded-2xl border border-border bg-card p-8 md:p-12">
				<div className="flex flex-col gap-6">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
						<Icon size={24} strokeWidth={1.5} className="text-primary" />
					</div>
					<h3 className="text-2xl font-bold tracking-tight md:text-3xl [font-family:'Geist_Variable',sans-serif]">
						{h.title}
					</h3>
					<p className="max-w-[65ch] leading-relaxed text-muted-foreground">{h.body}</p>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{h.points.map((p) => (
							<div key={p} className="rounded-2xl border border-border bg-background p-4 text-sm text-foreground/80">
								{p}
							</div>
						))}
					</div>
					{shot(h)}
				</div>
			</div>
		</div>
	);
}

export default function Highlights() {
	const bentos = HIGHLIGHTS.filter((h) => h.layout === "bento");
	return (
		<div className="mx-auto flex max-w-7xl flex-col gap-28 px-6 py-12">
			{HIGHLIGHTS.map((h) => {
				if (h.layout === "full")
					return <FeatureFull key={h.id} icon={h.icon} title={h.title} body={h.body} points={h.points} visual={shot(h)} />;
				if (h.layout === "split")
					return <FeatureSplit key={h.id} icon={h.icon} title={h.title} body={h.body} points={h.points} visual={shot(h)} />;
				if (h.layout === "split-reverse")
					return (
						<FeatureSplit
							key={h.id}
							icon={h.icon}
							title={h.title}
							body={h.body}
							points={h.points}
							reverse
							visual={
								<div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
									火山引擎 · 双路语音
								</div>
							}
						/>
					);
				if (h.layout === "sticky") return <StickyHighlight key={h.id} h={h} />;
				return null;
			})}
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
				{bentos.map((h) => (
					<BentoHighlight key={h.id} h={h} />
				))}
			</div>
		</div>
	);
}
