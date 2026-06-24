import { useEffect, useRef, useState } from "react";
import { OVERVIEW_STATS, type OverviewStat } from "../data";
import { prefersReducedMotion } from "../lib/gsap";

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
		const io = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				io.disconnect();
				const start = performance.now();
				const dur = 900;
				const tick = (t: number) => {
					const p = Math.min(1, (t - start) / dur);
					setN(Math.round(stat.value * (1 - (1 - p) ** 3)));
					if (p < 1) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}
		}, { threshold: 0.5 });
		io.observe(el);
		return () => io.disconnect();
	}, [stat.value]);

	return (
		<div ref={ref} className="flex flex-col items-center gap-1 text-center">
			<div className="text-4xl font-bold tracking-tight md:text-5xl [font-family:'Geist_Variable',sans-serif]">
				{n}
				<span className="text-2xl text-primary">{stat.suffix}</span>
			</div>
			<div className="text-sm text-muted-foreground">{stat.label}</div>
		</div>
	);
}

export default function Overview() {
	return (
		<section className="mx-auto max-w-5xl px-6 py-20">
			<div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
				{OVERVIEW_STATS.map((s) => (
					<Stat key={s.label} stat={s} />
				))}
			</div>
		</section>
	);
}
