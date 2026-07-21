import { useEffect, useRef } from "react";
import ConversationSnippets from "../components/ConversationSnippets";
import EmotionMatrix from "../components/EmotionMatrix";
import FeatureFull from "../components/layouts/FeatureFull";
import FeatureSplit from "../components/layouts/FeatureSplit";
import ProcessPipeline from "../components/ProcessPipeline";
import Reveal from "../components/Reveal";
import ScoreStream from "../components/ScoreStream";
import SectionHeading from "../components/SectionHeading";
import VoicePlayback from "../components/VoicePlayback";
import { HIGHLIGHTS, type Highlight } from "../data";
import { ensureGsap, prefersReducedMotion } from "../gsap";

function visualFor(h: Highlight) {
	if (h.id === "engine") return <ProcessPipeline />;
	if (h.id === "patient") return <ConversationSnippets />;
	if (h.id === "emotion") return <EmotionMatrix />;
	if (h.id === "scoring") return <ScoreStream />;
	if (h.id === "voice") return <VoicePlayback />;
	if (h.id === "rag") return (
		<div className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-5 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)]">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.08),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(13,148,136,0.06),transparent_34%)]" />
			<div className="relative z-10 flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">知识检索</div>
					<div className="mt-1 text-lg font-bold text-foreground">Tool Call · 教材溯源</div>
				</div>
				<div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
					<span className="size-1.5 rounded-full bg-orange-500" />
					RAG
				</div>
			</div>
			<div className="relative z-10 mt-4 rounded-2xl border border-border/50 bg-muted/30 p-4">
				<div className="text-[10px] font-mono text-primary/70 mb-2">$ browse_chapter "内科护理学"</div>
				<div className="space-y-2">
					{[
						{ name: "内科护理学", ch: "循环系统疾病病人的护理", match: "92%" },
						{ name: "健康评估", ch: "胸部体格检查", match: "87%" },
						{ name: "基础护理学", ch: "护患沟通技巧", match: "74%" },
					].map((doc, i) => (
						<div key={i} className="flex items-center justify-between rounded-xl bg-background/70 px-3 py-2.5 text-xs">
							<div>
								<div className="font-medium text-foreground/85">{doc.name}</div>
								<div className="text-[10px] text-muted-foreground/70">{doc.ch}</div>
							</div>
							<div className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{doc.match}</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
	return null;
}

function _BentoHighlight({ h }: { h: Highlight }) {
	const Icon = h.icon;
	return (
		<Reveal>
			<div className="group relative flex min-h-[500px] flex-col overflow-hidden rounded-3xl border border-border/50 bg-card p-8 transition-all hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/5">
				<div className="absolute -right-20 -top-20 size-40 rounded-full bg-primary/5 blur-3xl transition-all group-hover:bg-primary/10" />
				<div className="relative z-10 flex flex-1 flex-col">
					<div className="mb-6 flex items-center gap-4">
						<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
							<Icon size={24} strokeWidth={1.5} />
						</div>
						<h3 className="text-xl font-bold tracking-tight md:text-2xl [font-family:'Geist_Variable',sans-serif]">
							{h.title}
						</h3>
					</div>
					<p className="mb-5 leading-relaxed text-muted-foreground">{h.body}</p>
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
					<div className="mt-auto pt-5">{visualFor(h)}</div>
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
	return (
		<div className="mx-auto flex max-w-7xl flex-col gap-20 px-6 py-12">
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
		</div>
	);
}
