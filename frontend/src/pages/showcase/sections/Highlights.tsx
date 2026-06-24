import { useEffect, useRef } from "react";
import FeatureFull from "../components/layouts/FeatureFull";
import FeatureSplit from "../components/layouts/FeatureSplit";
import Reveal from "../components/Reveal";
import DialogueReveal from "../components/DialogueReveal";
import EmotionMatrix from "../components/EmotionMatrix";
import ProcessPipeline from "../components/ProcessPipeline";
import ScoreStream from "../components/ScoreStream";
import SectionHeading from "../components/SectionHeading";
import { HIGHLIGHTS, type Highlight } from "../data";
import { ensureGsap, prefersReducedMotion } from "../lib/gsap";

function visualFor(h: Highlight) {
	if (h.id === "engine") return <ProcessPipeline />;
	if (h.id === "patient") return <DialogueReveal />;
	if (h.id === "emotion") return <EmotionMatrix />;
	if (h.id === "scoring") return <ScoreStream />;
	if (h.id === "voice") {
		return (
			<div className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm">
				<div className="flex items-center justify-between gap-4">
					<div>
						<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">语音链路</div>
						<div className="mt-1 text-lg font-bold text-foreground">TTS · ASR · 降级</div>
					</div>
					<div className="size-10 rounded-full border border-border/60 bg-background/80" />
				</div>
				<div className="mt-5 grid gap-3">
					{[
						"SeedTTS 2.0 情绪联动",
						"BigASR 流式识别",
						"浏览器兜底与熔断保护",
					].map((item, index) => (
						<div key={item} className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
							<div className="text-sm text-foreground/85">{item}</div>
							<div className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">0{index + 1}</div>
						</div>
					))}
				</div>
			</div>
		);
	}
	return null;
}

function BentoHighlight({ h }: { h: Highlight }) {
	const Icon = h.icon;
	return (
		<Reveal>
			<div className="group relative overflow-hidden rounded-3xl border border-border/50 bg-card p-8 transition-all hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/5">
				<div className="absolute -right-20 -top-20 size-40 rounded-full bg-primary/5 blur-3xl transition-all group-hover:bg-primary/10" />
				<div className="relative z-10">
					<div className="mb-6 flex items-center gap-4">
						<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
							<Icon size={24} strokeWidth={1.5} />
						</div>
						<h3 className="text-xl font-bold tracking-tight md:text-2xl [font-family:'Geist_Variable',sans-serif]">
							{h.title}
						</h3>
					</div>
					<p className="mb-6 leading-relaxed text-muted-foreground">{h.body}</p>
					<div className="flex flex-wrap gap-2">
						{h.points.map((p) => (
							<span
								key={p}
								className="rounded-lg border border-border/50 bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground/80 backdrop-blur-sm"
							>
								{p}
							</span>
						))}
					</div>
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
					{ y: 50, opacity: 0.9 },
					{
						y: 0,
						opacity: 1,
						ease: "power2.out",
						scrollTrigger: { 
							trigger: root.current, 
							start: "top bottom-=100", 
							end: "top center", 
							scrub: true 
						},
					},
				);
			});
		}, root);
		return () => ctx.revert();
	}, []);

	const Icon = h.icon;
	return (
		<div ref={root} className="py-6">
			<div ref={card} className="overflow-hidden rounded-3xl border border-border bg-card/50 shadow-lg backdrop-blur-sm transition-all hover:bg-card">
				<div className="flex flex-col gap-8 p-8 md:p-12 lg:p-16">
					<div className="flex items-center gap-5">
						<div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-xl shadow-primary/20">
							<Icon size={28} strokeWidth={1.5} />
						</div>
						<h3 className="text-3xl font-extrabold tracking-tight md:text-4xl [font-family:'Geist_Variable',sans-serif]">
							{h.title}
						</h3>
					</div>
					<p className="max-w-[55ch] text-lg leading-relaxed text-muted-foreground md:text-xl">{h.body}</p>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{h.points.map((p) => (
							<div key={p} className="flex items-center gap-3 rounded-2xl border border-border/50 bg-background/50 p-4 text-sm font-medium text-foreground transition-colors hover:border-primary/20">
								<div className="size-1.5 rounded-full bg-primary" />
								{p}
							</div>
						))}
					</div>
					<div className="relative mt-4">
						<div className="absolute inset-0 -z-10 translate-y-4 rounded-3xl bg-primary/5 blur-2xl" />
						{visualFor(h)}
					</div>
				</div>
			</div>
		</div>
	);
}

export default function Highlights() {
	const bentos = HIGHLIGHTS.filter((h) => h.layout === "bento");
	return (
		<div className="mx-auto flex max-w-7xl flex-col gap-28 px-6 py-12">
			<SectionHeading
				eyebrow="核心能力"
				title="六大技术亮点"
				className="mb-4"
			/>
			{HIGHLIGHTS.map((h) => {
				if (h.layout === "full")
					return <FeatureFull key={h.id} icon={h.icon} title={h.title} body={h.body} points={h.points} visual={visualFor(h)} />;
				if (h.layout === "split")
					return <FeatureSplit key={h.id} icon={h.icon} title={h.title} body={h.body} points={h.points} visual={visualFor(h)} />;
				if (h.layout === "split-reverse")
					return (
						<FeatureSplit
							key={h.id}
							icon={h.icon}
							title={h.title}
							body={h.body}
							points={h.points}
							reverse
							visual={visualFor(h)}
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
