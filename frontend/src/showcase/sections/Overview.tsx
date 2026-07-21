import { useEffect, useRef, useState } from "react";
import { OVERVIEW_STATS, type OverviewStat } from "../data";
import { prefersReducedMotion } from "../gsap";

function Stat({ stat }: { stat: OverviewStat }) {
	const ref = useRef<HTMLDivElement>(null);
	const [n, setN] = useState(() => (prefersReducedMotion() ? stat.value : 0));

	useEffect(() => {
		if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
			setN(stat.value);
			return;
		}
		const el = ref.current;
		if (!el) return;
		let raf = 0;
		const io = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				io.disconnect();
				const start = performance.now();
				const dur = 900;
				const tick = (t: number) => {
					const p = Math.min(1, (t - start) / dur);
					setN(Math.round(stat.value * (1 - (1 - p) ** 3)));
					if (p < 1) raf = requestAnimationFrame(tick);
				};
				raf = requestAnimationFrame(tick);
			}
		}, { threshold: 0.5 });
		io.observe(el);
		return () => {
			io.disconnect();
			cancelAnimationFrame(raf);
		};
	}, [stat.value]);

	return (
		<div ref={ref} className="group relative z-10 flex flex-col items-center gap-3 text-center">
			<div className="absolute -inset-4 -z-10 scale-90 rounded-3xl bg-primary/5 opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100" />
			<div className="text-4xl font-extrabold tracking-tighter md:text-[4.5rem] lg:text-7xl [font-family:'Geist_Variable',sans-serif]">
				<span className="bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent">{n}</span>
				<span className="text-xl font-bold text-primary md:text-2xl">{stat.suffix}</span>
			</div>
			<div className="max-w-[12ch] text-[11px] font-semibold uppercase leading-relaxed tracking-[0.22em] text-muted-foreground/70">
				{stat.label}
			</div>
		</div>
	);
}

export default function Overview() {
	return (
		<section className="relative mx-auto max-w-5xl px-6 py-20 md:py-24">
			<div className="absolute inset-0 -z-10 mx-auto h-[1px] max-w-4xl bg-gradient-to-r from-transparent via-border to-transparent" />
			<div className="grid grid-cols-1 gap-12 sm:grid-cols-3">
				{OVERVIEW_STATS.map((s) => (
					<Stat key={s.label} stat={s} />
				))}
			</div>
		</section>
	);
}
