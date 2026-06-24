import Reveal from "../components/Reveal";
import SectionHeading from "../components/SectionHeading";
import { ENGINEERING } from "../data";

export default function EngineeringBand() {
	return (
		<section className="mx-auto max-w-7xl px-6 py-24">
			<SectionHeading eyebrow="工程化底座" title="可观测、可控、可部署" className="mb-12" />
			<Reveal>
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
					{ENGINEERING.map((c) => (
						<div
							key={c.label}
							className="group relative flex items-center justify-center rounded-2xl border border-border/60 bg-card px-4 py-6 text-center transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5"
						>
							<div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-primary/10 to-blue-500/10 opacity-0 blur-md transition-opacity group-hover:opacity-100" />
							<span className="relative text-sm font-bold tracking-tight text-foreground/80 transition-colors group-hover:text-primary">
								{c.label}
							</span>
						</div>
					))}
				</div>
			</Reveal>
		</section>
	);
}
